# Distribución privada de la app

> Objetivo: que la app se instale **solamente en los celulares de WoodTools**, que
> no aparezca en ninguna tienda pública, y que si el APK se filtra igual no sirva
> para nada.

---

## La idea central: tres candados independientes

Ningún mecanismo de Android impide, por sí solo, que alguien instale un APK que
consiguió. Por eso la protección real está repartida en tres capas, y hay que
tener las tres:

| # | Candado | Qué frena | Dónde vive |
|---|---|---|---|
| 1 | **Canal de distribución cerrado** | Que el APK circule | Managed Google Play / EAS internal distribution |
| 2 | **Alta aprobada por un administrador** | Que alguien con credenciales robadas entre | Tabla `perfiles.estado` + RLS |
| 3 | **Teléfono habilitado** | Que alguien instale el APK en un equipo ajeno | Tabla `dispositivos.autorizado` |

Los candados 2 y 3 **ya están implementados** y son los que de verdad protegen:
si alguien obtiene el APK e intenta entrar, se queda mirando la pantalla
"tu cuenta está en revisión" para siempre. La app sin backend no hace nada.

> **Lo importante:** el APK no contiene datos de clientes ni de recorridos. Todo
> vive en Supabase detrás de RLS. Un APK filtrado es una cáscara vacía.

---

## Candado 1 — elegir el canal

Hay tres caminos. Recomendación: **empezar por B y migrar a A antes de 2027.**

### A. Managed Google Play — *Private apps* ← recomendado a largo plazo

Es la opción que Google diseñó exactamente para este caso.

- La app **no es visible en el Play Store público**; sólo la ven los usuarios de
  las organizaciones que vos indiques (hasta 1.000 Organization IDs por app).
- Publicando desde el iframe del EMM, **Google crea la cuenta de desarrollador
  gratis**: no se pagan los USD 25 de registro.
- Queda lista para distribuir en unos 10 minutos. Límite: 15 private apps por día.
- **Contra:** una private app publicada así no se puede volver pública nunca ni
  transferir a otra cuenta.

**Por qué importa para 2027:** Google está desplegando *Android Developer
Verification*, que va a exigir identidad verificada del desarrollador para poder
instalar apps incluso por sideload en dispositivos certificados. El calendario
oficial marca enforcement en Brasil, Indonesia, Singapur y Tailandia el
**30/9/2026** y expansión global durante **2027** — Argentina entra en esa ola.

Las apps distribuidas por el store de la organización en dispositivos
gestionados **quedan exentas** de ese requisito. Ése es el argumento fuerte para
terminar en este canal.

> Si prefieren no armar Android Enterprise, la modalidad *Limited Distribution*
> de la verificación es gratuita y no pide documento, pero está **limitada a 20
> dispositivos**. Si WoodTools nunca va a pasar de 20 celulares, alcanza.

### B. EAS Build — *internal distribution* ← para arrancar ya

```bash
cd apps/movil
eas build --profile interno --platform android
```

Con `"distribution": "internal"` (ya está en `eas.json`), EAS genera un **APK**
instalable en lugar de un AAB, y devuelve un link con QR.

> ⚠️ **Paso obligatorio de seguridad.** Por defecto ese link es público: la URL
> lleva un UUID de 32 caracteres, pero cualquiera que la tenga baja el APK. Hay
> que entrar al dashboard de EAS → **Project settings** y **desactivar
> "Unauthenticated access to internal builds"**. A partir de ahí hace falta
> iniciar sesión con una cuenta de Expo autorizada para descargar.

Aclaración importante: el *device registration* (`eas device:create`) que limita
la instalación a equipos concretos **existe sólo para iOS**. En Android no hay
allowlist de dispositivos a nivel de build — por eso el candado 3 se implementa
en el backend.

### C. Google Play — Internal / Closed testing

- **Internal testing:** hasta 100 testers por email, publica en minutos.
- **Closed testing:** hasta 2.000 usuarios por lista.
- Requiere cuenta de desarrollador (USD 25) y que cada empleado use una cuenta
  de Google personal.
- La regla de "12 testers durante 14 días" **sólo aplica a cuentas personales**
  creadas después del 13/11/2023; una cuenta de **Organización** queda fuera.

Es más burocrático que A o B y no aporta nada que los otros no den.

---

## Candado 2 — alta aprobada por un administrador

Ya implementado. Un usuario recién creado nace con `estado = 'pendiente'`
(trigger `al_crear_usuario`) y **no puede leer ni escribir nada**: todas las
políticas de RLS pasan por `interno.esta_habilitado()`.

El administrador aprueba desde el panel de escritorio → **Usuarios**, y ahí mismo
le asigna el rol y el código de vendedor.

Detalle de diseño: los helpers `interno.rol_actual()` y `interno.estado_actual()`
leen la tabla en cada consulta en vez de confiar en el JWT. Cuesta un poco más,
pero significa que **suspender a alguien tiene efecto inmediato**, y no dentro de
una hora cuando venza su token.

---

## Candado 3 — teléfono habilitado

Ya implementado. La primera vez que la app arranca genera un **GUID aleatorio**
y lo guarda en el Keystore de Android (`expo-secure-store`).

> Se usa un GUID propio y **no** el ANDROID_ID ni el IMEI. Es lo que Google
> indica expresamente: los identificadores de hardware están restringidos desde
> Android 10 y su uso puede hacer rechazar la app.

Ese identificador se registra en la tabla `dispositivos` con
`autorizado = false`. El vendedor ve en pantalla los primeros 8 caracteres y se
los pasa a la oficina; el administrador lo habilita desde el panel →
**Usuarios → Teléfonos por habilitar**.

Como el GUID se pierde al desinstalar, **reinstalar exige volver a pedir
autorización**. Es intencional.

---

## Actualizaciones

Se usan **EAS Update** (OTA), no la descarga de un APK nuevo:

```bash
cd apps/movil
eas update --branch produccion --message "Corrección del formulario de visitas"
```

Los canales de EAS Update funcionan con builds de internal distribution sin
problema: el canal se fija en el build (`eas.json`), no en el modo de
distribución.

**Por qué no auto-actualizamos bajando un APK:** haría falta el permiso
`REQUEST_INSTALL_PACKAGES`, que la política de Google Play prohíbe expresamente
para apps que se auto-actualizan por fuera de Play. Pedirlo cerraría la puerta al
canal A. Por eso `app.config.ts` **no** lo declara.

### Firmar los updates (recomendado)

Sin *code signing*, cualquiera con acceso a la cuenta de Expo puede publicar un
update que llegue a los celulares. Con firma, la app rechaza todo lo que no esté
firmado con la clave privada de WoodTools:

```bash
npx expo-updates codesigning:generate --key-output-directory ../claves --certificate-output-directory certs --certificate-validity-duration-years 10 --certificate-common-name "WoodTools SRL"
npx expo-updates codesigning:configure --certificate-input-directory certs --key-input-directory ../claves
eas update --branch produccion --private-key-path ../claves/private-key.pem
```

La clave privada **no sale de la máquina de la oficina**. Requiere plan EAS
Production o Enterprise.

---

## Sobre "proteger la idea"

Conviene ser directo, porque acá hay bastante mito:

- **Hermes no es ofuscación.** Compila el JavaScript a bytecode por velocidad de
  arranque, no por seguridad. Existen decompiladores públicos (`hbctool`,
  `hermes-dec`, JEB) que reconstruyen pseudo-JavaScript legible, y **los strings
  —URLs, claves— salen enteros**.
- **R8/ProGuard** (activado en `app.config.ts` con `enableMinifyInReleaseBuilds`)
  ofusca la capa Java/Kotlin, **no el bundle de JavaScript**.
- **Play Integrity API no sirve** para un APK instalado fuera de Play: devuelve
  `UNRECOGNIZED_VERSION` y `UNLICENSED` siempre. Sólo tiene sentido si se
  distribuye por Managed Google Play (canal A).
- **SafetyNet Attestation está apagado** desde el 31/1/2025. No es una opción.

**La conclusión operativa:** todo control que viva en el cliente es visible y
modificable. Por eso el diseño pone las claves de Google Maps (servidor) y de
Gemini **únicamente en las Edge Functions**, y toda la autorización en RLS. Lo
que realmente protege la operación de WoodTools no es el APK: es que sin una
cuenta aprobada y un teléfono habilitado, la app no devuelve un solo dato.

---

## Lista de verificación antes de repartir los celulares

- [ ] Desactivar "Unauthenticated access to internal builds" en EAS.
- [ ] Las claves de Google Maps y Gemini están cargadas con `supabase secrets set`, no en el repo.
- [ ] La clave `GOOGLE_MAPS_ANDROID_KEY` está restringida por nombre de paquete + SHA-1.
- [ ] La clave `GOOGLE_MAPS_SERVER_KEY` está restringida a Routes API + Places API (New).
- [ ] `enable_signup = false` en `supabase/config.toml`: nadie se registra solo.
- [ ] Todas las tablas tienen RLS activo (verificar en Dashboard → Database → Tables).
- [ ] Hay al menos dos administradores, para no quedar bloqueados si uno pierde el acceso.
- [ ] Los vendedores firmaron la constancia de consentimiento del seguimiento de ubicación.
- [ ] Cada celular tiene desactivada la optimización de batería para la app (ver abajo).

### Optimización de batería

Es la causa número uno de "se me cortó el seguimiento". Samsung, Xiaomi y otros
fabricantes matan los servicios en segundo plano aunque el código sea correcto.
En cada teléfono:

**Ajustes → Aplicaciones → WoodTools Visitas → Batería → Sin restricciones.**

Además, en Android 15 y superiores, si el sistema mata el proceso o el teléfono
se reinicia, **el seguimiento no se puede reanudar solo**: el vendedor tiene que
volver a tocar "Iniciar recorrido". Conviene avisarlo en la capacitación.
