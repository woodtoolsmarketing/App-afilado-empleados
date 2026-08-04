# Arquitectura

## Stack y por qué

| Pieza | Elección | Motivo |
|---|---|---|
| App Android | **Expo (React Native)** | Compila y distribuye APK privados con EAS sin tocar Android Studio, y comparte tipos y validaciones con el panel de escritorio. |
| Panel PC | **Electron + React + Vite** | Ejecutable de Windows instalable, con la misma base de React. Imprime la planilla en A4 sin depender del navegador. |
| Nube | **Supabase** | Postgres con RLS, Auth, Realtime, Storage y Edge Functions en un solo lugar. La autorización vive en la base, no en cada cliente. |
| Mapas | **Google Routes API + Places API (New)** | Directions API pasó a *Legacy* el 1/3/2025 y ya no se puede habilitar en proyectos de Cloud nuevos. |
| Voz a texto | **Gemini · Interactions API** | Transcribe español rioplatense sin entrenar nada. `generateContent` quedó como legacy. |
| Tipografía | **Poppins** | Geométrica y de trazo grueso: es la que reproduce el aire de los mockups y se lee al sol. |

### Por qué el código está en español

Los nombres del dominio son los de la planilla que usa WoodTools hoy: *rol de
visita*, *parada*, *retiró afilado*. Traducirlos a inglés agregaría una capa de
traducción mental en cada lectura del código, sin ganar nada.

---

## Modelo de datos

```
auth.users
    │
    └─→ perfiles ──────┬─→ dispositivos          (qué celulares están habilitados)
         (rol, estado) │
                       ├─→ clientes ─→ direcciones   (con PostGIS para ordenar por cercanía)
                       │
                       └─→ roles_visita             (una hoja de planilla: un vendedor, un día)
                                │
                                ├─→ paradas          (cada renglón numerado)
                                │      └─→ visitas   (el formulario "¿Destino visitado?")
                                │
                                ├─→ posiciones_actuales   (1 fila por vendedor → mapa en vivo)
                                └─→ posiciones            (traza histórica, append-only)
```

### Correspondencia con la planilla en papel

| Columna del PDF | Dónde vive |
|---|---|
| FECHA | `roles_visita.fecha` |
| Vendedor / Codigo | `perfiles.nombre_completo` / `perfiles.codigo_vendedor` |
| Nº | `paradas.orden` |
| HORA | `paradas.llegada_en` |
| CLIENTE Nº | `clientes.codigo` |
| RAZON SOCIAL O NOMBRE | `clientes.razon_social` |
| VENDIO / COBRO / RET.AFIL / ENTREGO | `visitas.vendio` · `cobro` · `retiro_afilado` · `entrego` |
| ATENDIDO CONTACTO | `visitas.contacto_nombre` |
| RESULTADO (OBSERVACIONES) | `visitas.observacion` |

La vista `vista_rol_de_visita` reconstruye la planilla completa en una sola
consulta. Es la que usa el panel para imprimir y la Edge Function para exportar
a Excel.

---

## Seguridad

### Tres capas, en orden

1. **Autenticación** — Supabase Auth. `enable_signup = false`: nadie se registra
   solo, las altas las crea un administrador.
2. **Autorización** — RLS en todas las tablas. Un vendedor sólo ve sus propias
   jornadas, visitas y posiciones; un administrador ve todo.
3. **Habilitación** — el alta tiene que estar aprobada (`perfiles.estado`) y el
   teléfono autorizado (`dispositivos.autorizado`).

### Por qué RLS consulta la base y no el JWT

Los helpers `interno.rol_actual()` / `interno.estado_actual()` son
`SECURITY DEFINER` y leen `public.perfiles` directamente:

```sql
create or replace function interno.rol_actual()
returns public.rol_usuario
language sql stable security definer
set search_path = public, pg_temp
as $$ select rol from public.perfiles where id = auth.uid(); $$;
```

Ventajas frente a leer `auth.jwt()`:

- **Sin recursión.** Al saltear RLS, las políticas de `perfiles` pueden usarlos
  sin que se llamen a sí mismas.
- **Sin estado viejo.** El JWT dura una hora. Si un vendedor renuncia y se lo
  suspende, con el JWT seguiría entrando hasta que venza el token; leyendo la
  tabla, deja de entrar al instante.

El hook `custom_access_token_hook` igual mete `rol` y `estado` en el token, pero
sólo como comodidad de la interfaz (para saber qué pantalla mostrar). **La
autorización nunca depende de esos claims.** El hook está envuelto en un
`exception when others then return event`: si fallara, se pierden los claims
extra pero nadie se queda afuera del sistema.

### Dónde vive cada clave

| Clave | Ubicación | Motivo |
|---|---|---|
| `SUPABASE_ANON_KEY` | App + panel | Es pública por diseño; RLS hace el trabajo. |
| `GOOGLE_MAPS_ANDROID_KEY` | Dentro del APK | Restringida por package name + SHA-1: fuera de la app no sirve. |
| `GOOGLE_MAPS_SERVER_KEY` | Sólo Edge Functions | No tiene restricción de app: en el APK sería robable. |
| `GEMINI_API_KEY` | Sólo Edge Functions | Ídem. |
| Clave de servicio | Nunca en un cliente | Sólo scripts locales de migración. |

---

## Decisiones que conviene conocer

### 1. La navegación va tramo a tramo

**Calcular** el recorrido soporta hasta 25 paradas intermedias (Routes API), así
que los 13 destinos del ejemplo entran holgados. Pero **abrir Google Maps** con
todas las paradas no se puede: la URL universal admite como máximo 9 waypoints, y
sólo 3 en navegadores móviles.

Por eso la app lanza la navegación **al próximo destino nada más**. Además de ser
lo único que funciona con más de 9 paradas, es lo correcto: la ruta se recalcula
con el tránsito de ese momento, y si aparece un destino de prioridad alta se
intercala sin rearmar nada. El recorrido completo se ve igual dentro de la app,
dibujado con la polilínea que devuelve Routes API — ahí no hay límite.

### 2. Las prioridades se aplican después de Google

Google optimiza por tiempo de manejo; no entiende de prioridades comerciales. El
orden se arma en tres tiempos dentro de `optimizar-ruta`:

1. Las paradas **alta** se sacan de la optimización y se clavan adelante.
2. El resto lo ordena Google por tiempo real de manejo.
3. Las **media** se corren a la posición 3 dentro de ese resto.

Las **baja** quedan donde las puso Google: puro criterio de cercanía.

### 3. Dos tablas de posiciones

`posiciones_actuales` tiene **una fila por vendedor** y es la única publicada en
Realtime. `posiciones` guarda la traza histórica y no se publica.

Postgres Changes autoriza cada evento contra cada suscriptor: publicar la tabla
histórica generaría tráfico y ruido innecesarios hacia el panel. Con esta
separación, el mapa en vivo es liviano y el histórico, barato.

**No está particionada a propósito.** Con 5 a 30 vendedores son ~1 millón de
filas en 90 días — volumen trivial para Postgres. Particionar traería tres
problemas concretos: RLS no se hereda a las particiones (agujero por el que se
filtraría el GPS de todo el equipo), las columnas `identity` en tablas
particionadas necesitan PostgreSQL 17, y `DETACH PARTITION CONCURRENTLY` no
puede correr dentro de una transacción de `pg_cron`. Un `DELETE` mensual resuelve
lo mismo sin ninguno de esos riesgos.

### 4. Las mutaciones importantes son funciones de Postgres

`registrar_visita`, `agregar_parada`, `iniciar_recorrido` y `finalizar_recorrido`
son funciones SQL, no secuencias de `update` desde el teléfono. Registrar una
visita implica escribir en `visitas`, cerrar la parada y pasar la siguiente a
"en camino": si se corta la señal en el medio, la jornada quedaría inconsistente.
Como función, o pasa todo o no pasa nada.

### 5. La cola de posiciones sobrevive a la falta de señal

Si el `insert` de una posición falla, el punto se guarda en disco
(`AsyncStorage`) y se reintenta con la próxima que sí salga. Un vendedor que
entra a un túnel o a una zona sin cobertura no deja huecos en el histórico.

---

## Costos estimados

Con 5–10 vendedores y ~15 destinos diarios cada uno:

| Servicio | Consumo mensual | Costo |
|---|---|---|
| Routes API (optimización) | ~300 requests | **USD 0** — entran en los 5.000 gratis del SKU *Compute Routes Pro* |
| Places API (autocompletado) | Bajo | Dentro del crédito mensual de Google Maps |
| Gemini (transcripción) | ~500 notas de voz | **≈ USD 0,50** con `gemini-3.5-flash-lite` |
| Supabase | Base + Realtime + Storage | Free alcanza para arrancar; Pro (USD 25) si hace falta *time-box* de sesión nativo |
| EAS | Builds internos | Free alcanza; Production si se quiere firmar los updates |

> Las cuentas de Routes API asumen **una optimización por vendedor por día**. Si
> se reoptimiza cada vez que se agrega un destino, multiplicá en consecuencia —
> igual queda lejos del límite gratuito.
