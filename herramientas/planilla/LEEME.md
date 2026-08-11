# La planilla de ubicaciones

Un espejo del padrón de clientes en Google Sheets. Se puede mirar, y se puede
editar: lo que se cambie ahí vuelve a la base.

## Cómo está armado

```
   APP DEL CELULAR ──┐
                     ├──> SUPABASE ──> Edge Function `planilla` <──> PLANILLA
   PANEL DE PC ──────┘    (la base)     (el puente)                  (el espejo)
```

Supabase es la fuente de verdad. La planilla no reemplaza a la base: la refleja
y le puede escribir. Si Google se cae, el recorrido y el mapa siguen andando.

La planilla **no conoce ninguna credencial de Supabase**. Sólo sabe dos cosas:
la URL de la función y una clave compartida. Todo el acceso privilegiado vive
del lado del servidor.

## Por qué una cuenta de servicio no, y Apps Script sí

El plan original era una cuenta de servicio de Google Cloud. La organización
tiene activada la política `iam.disableServiceAccountKeyCreation`, que impide
crear claves para cuentas de servicio — es una protección por defecto de Google,
porque esas claves son la fuente más común de filtraciones.

Apps Script evita el problema de raíz: el código corre con la cuenta del dueño
de la planilla, que ya tiene acceso al archivo. No hay ninguna credencial nueva
que crear, guardar ni rotar.

## Quién le gana a quién cuando los dos cambian

Cada fila lleva al final tres columnas ocultas (`_sync_dir`, `_sync_lat`,
`_sync_lng`) con el último valor que bajó de la base.

- Si la celda visible **difiere** de su respaldo → alguien la editó a mano →
  **gana la planilla** y el cambio se sube.
- Si **coincide** → nadie la tocó → **gana la base** y la celda se actualiza.

Sin ese respaldo habría que elegir entre pisar siempre lo que escribe la
oficina o pisar siempre lo que carga el vendedor desde la calle. Con él, cada
cambio real se respeta una sola vez y de un solo lado.

## Instalación

**1.** Creá una planilla nueva en Google Sheets, vacía. No le pongas
encabezados: los arma el script para que queden exactamente como los espera.

**2.** Dentro de la planilla: **Extensiones → Apps Script**. Borrá lo que haya
en el editor y pegá todo el contenido de `Codigo.gs`. Guardá con el disquete.

**3.** Volvé a la planilla y recargá la página. Va a aparecer un menú
**WoodTools** al lado de Ayuda.

**4.** **WoodTools → Configurar conexión**. Te pide dos cosas:

- La URL: `https://<tu-proyecto>.supabase.co/functions/v1/planilla`
- La clave: el valor de `PLANILLA_SECRETO` en el archivo `.env` del proyecto

**5.** **WoodTools → Sincronizar ahora**. La primera vez Google te va a pedir
autorización para que el script acceda a la planilla y a internet: es esperado,
el script es tuyo y corre con tu cuenta.

**6.** Opcional: **WoodTools → Sincronizar cada 15 minutos** para que se
mantenga sola.

## Qué se puede editar en la planilla

| Columna | Se puede editar |
|---|---|
| Código | No — es la clave que une cada fila con su cliente |
| Razón social | No — baja de la base y se sobrescribe |
| Dirección | **Sí** |
| Localidad | **Sí** |
| CP | **Sí** |
| Latitud / Longitud | **Sí** |
| Estado | No — lo calcula la base |

Si escribís una dirección y dejás lat/lng vacías, el servidor la busca en Google
y completa las coordenadas solo. Si escribís lat/lng a mano, mandan ésas y no se
consulta a Google — útil cuando el lugar no figura en ningún mapa.

**No agregues ni borres filas.** Cada sincronización reescribe la hoja completa
desde la base, así que una fila agregada a mano se pierde. Para dar de alta un
cliente, el panel de escritorio.

## Cambiar la clave

Si hace falta rotarla:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Ese valor va a `PLANILLA_SECRETO` en el `.env`, después `npm run secretos`, y
por último **WoodTools → Configurar conexión** en la planilla con el valor
nuevo. Hasta que hagas lo último, la planilla va a recibir un 401.
