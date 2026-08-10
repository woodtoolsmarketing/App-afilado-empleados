# WoodTools — App de Rol de Visita

Sistema interno privado de WoodTools S.R.L. para la organización y el seguimiento de las
visitas diarias de los vendedores.

> ⚠️ **Software privado de uso interno.** No se publica en Google Play ni en ningún repositorio
> público. La distribución del APK está restringida a dispositivos autorizados. Ver
> [`docs/DISTRIBUCION-PRIVADA.md`](docs/DISTRIBUCION-PRIVADA.md).

---

## Qué es

Reemplaza la planilla en papel **"Rol de Visita"** (fecha / vendedor / código, y por cada renglón:
hora, cliente, razón social, tipo de visita —vendió, cobró, retiró afilado, entregó—, contacto
atendido y resultado/observaciones) por:

| | |
|---|---|
| 📱 **App Android** | El vendedor ve sus envíos del día, arranca el recorrido optimizado por Google Maps, y completa el parte de cada visita (con dictado por voz). |
| 💻 **App de escritorio (Windows)** | El administrador da de alta/baja vendedores y clientes, aprueba los inicios de sesión, arma los roles de visita, imprime, y ve **en vivo** dónde está cada vendedor. |
| ☁️ **Nube (Supabase)** | Postgres + Auth + Realtime + Storage + Edge Functions. Una sola fuente de verdad. |

---

## Estructura del repositorio

```
App-afilado-empleados/
├─ apps/
│  ├─ movil/          Expo (React Native) — app Android de los vendedores
│  └─ escritorio/     Electron + React + Vite — panel de administración
├─ packages/
│  └─ compartido/     Tipos, tokens de marca, validaciones y cliente Supabase compartidos
├─ supabase/
│  ├─ migrations/     Esquema SQL versionado (fuente de verdad de la base)
│  └─ functions/      Edge Functions (Deno): Gemini, Google Maps, aprobaciones, archivado
└─ docs/              Arquitectura, alcance por paso, distribución, configuración
```

## Documentación

| Documento | Contenido |
|---|---|
| [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) | Stack, modelo de datos, seguridad, decisiones y por qué |
| [`docs/PASO-1-ALCANCE.md`](docs/PASO-1-ALCANCE.md) | Qué entra y qué no entra en el Paso 1 |
| [`docs/INSTALADORES.md`](docs/INSTALADORES.md) | Cómo se arma el `.exe` del panel y el `.apk` del celular, paso a paso |
| [`docs/DISTRIBUCION-PRIVADA.md`](docs/DISTRIBUCION-PRIVADA.md) | Cómo se compila, se firma y se instala el APK sólo en los celulares habilitados |
| [`docs/CONFIGURACION.md`](docs/CONFIGURACION.md) | Variables de entorno, claves de API y puesta en marcha paso a paso |

## Puesta en marcha rápida

```bash
npm install
```

Después seguí [`docs/CONFIGURACION.md`](docs/CONFIGURACION.md) — hace falta cargar las claves de
Supabase, Google Maps y Gemini antes de poder levantar nada.

---

© WoodTools S.R.L. — Uso interno exclusivo.
# App-afilado-empleados
