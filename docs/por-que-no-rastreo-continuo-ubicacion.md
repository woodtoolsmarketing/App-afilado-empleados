# Por qué no se implementa el rastreo de ubicación continuo ("en todo momento")

*Documento interno para la gerencia — WoodTools S.R.L. — 6/10/2026*

> **Nota:** esto no es asesoramiento legal. Es una explicación basada en las
> políticas de las plataformas y en las normas y guías que se citan. Para una
> decisión definitiva conviene validarlo con un abogado laboral / de protección
> de datos en Argentina.

---

## La idea en una frase

**No es que sea técnicamente imposible** (de hecho lo construimos y lo probamos).
El problema es que rastrear la ubicación del teléfono de los vendedores de forma
**continua, en segundo plano y "en todo momento"** choca con tres cosas al mismo
tiempo:

1. **El sistema operativo (Android) no deja hacerlo de forma oculta ni
   confiable** — obliga a mostrarle al empleado un aviso permanente, el empleado
   controla el permiso y puede cortarlo, y el teléfono lo mata por batería.
2. **No es conforme a los estándares de las plataformas y las APIs que usamos**
   (Google Play como estándar; los términos de Google Maps, que sí nos obligan).
3. **Es de alto riesgo legal** bajo la ley argentina de **protección de datos**
   y el **derecho laboral** — hay incluso un fallo casi idéntico que condenó a
   una empresa por rastrear vendedores por GPS.

**Lo que sí se puede hacer, y es lo que quedó:** rastrear la ubicación **sólo
durante el recorrido de visitas activo**, informado al vendedor. Eso es
defendible. El "modo continuo" se revirtió.

---

## 1. Barreras técnicas del sistema operativo Android

> **Punto clave para la gerencia:** estas barreras las impone **Android**, no la
> tienda de Google. Por eso **aplican igual aunque usemos un APK interno** que
> nunca pasa por Google Play. La idea de "como es nuestra app, no hay reglas" es
> falsa para esto.

| Barrera | Qué significa |
|---|---|
| **No se puede rastrear a escondidas** | Para usar la ubicación con la pantalla apagada hay que correr un "servicio en primer plano", y Android **obliga a mostrar una notificación permanente y visible** ("…tu ubicación está activa"). Desde Android 14 encima hay que declararlo explícitamente o la app falla. **El empleado siempre ve que lo están ubicando.** |
| **El empleado controla el permiso, no la oficina** | Desde Android 10 el permiso de ubicación "en segundo plano" es aparte y lo concede el empleado; desde Android 11 **ni siquiera aparece en el cartel: hay que ir a Ajustes a mano** y elegir "Permitir siempre". Lo puede **revocar o bajar a ubicación aproximada** cuando quiera, y la oficina no lo puede impedir. |
| **No se puede "prender solo a las 8"** | Desde Android 12 una app **no puede arrancar el servicio de ubicación si está cerrada**. El escenario "el lunes a las 8 el teléfono empieza a reportar solo" no es un camino soportado. |
| **La batería lo corta** | El ahorro de energía de Android (Doze) y sobre todo los administradores agresivos de **Samsung, Xiaomi, Huawei, etc.** matan el servicio en segundo plano salvo que **cada empleado** saque la app de la optimización de batería a mano, teléfono por teléfono. El rastreo "continuo" queda, en la práctica, **con huecos impredecibles**. |

**Conclusión del frente técnico:** aun saltándonos todo lo legal, Android hace
que el rastreo sólo sea posible **con el conocimiento del empleado y con un aviso
permanente a la vista**, y encima **no es confiable**. "Verlos en todo momento
sin que se den cuenta" directamente no se puede.

*Fuentes: Android Developers — [Permiso de ubicación en segundo plano](https://developer.android.com/develop/sensors-and-location/location/permissions/background), [Tipos de servicio en primer plano (Android 14)](https://developer.android.com/about/versions/14/changes/fgs-types-required), [Restricciones de inicio desde segundo plano (Android 12)](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start), [Doze y App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby); [DontKillMyApp](https://dontkillmyapp.com/).*

---

## 2. Políticas de las plataformas y términos de las APIs

### Google Play (hoy no nos obliga, pero marca el estándar)
Como la app se distribuye por **APK interno (fuera de la tienda)**, las políticas
de Google Play **no nos obligan contractualmente hoy** — sería un error decir que
"Google lo prohíbe". Pero fijan lo que la industria considera aceptable y serían
un muro si alguna vez quisiéramos publicar en la tienda:
- La ubicación en segundo plano sólo se admite si es la **funcionalidad central**
  del app (la nuestra no: arma recorridos y toma notas, funciona sin rastreo
  permanente) y pidiendo **el mínimo necesario**.
- Exige **divulgación prominente y consentimiento explícito** antes de pedir el
  permiso, y una **revisión manual de Google** (formulario + video).
- El monitoreo de empleados sólo se permite como app **exclusivamente diseñada y
  declarada** para eso (flag `isMonitoringTool`) y **con notificación visible**;
  rastrear sin aviso cae en la definición de **"stalkerware"** (software de
  acecho) de Google.

### Google Maps Platform (esto sí nos obliga — usamos la clave de Maps)
Nuestra app usa la clave de Google Maps y geocodifica las posiciones. Los
**Términos de Google Maps Platform** exigen **no obtener ni guardar la ubicación
de un usuario salvo con su consentimiento previo, expreso y revocable**, tener una
**política de privacidad publicada** y cumplir las leyes de privacidad. Un rastreo
encubierto **incumpliría ese contrato**, poniendo en riesgo la clave/servicio de
Maps del que depende la app.

### Apple (si algún día hay versión iPhone)
Las reglas de la App Store piden lo mismo (consentimiento, textos de permiso
honestos, no reutilizar datos) e iOS no permite un "siempre activo" silencioso.

*Fuentes: [Google Play — Permisos de ubicación](https://support.google.com/googleplay/android-developer/answer/9799150); [Google Play — Stalkerware / apps de monitoreo](https://support.google.com/googleplay/android-developer/answer/12955211); [Google Maps Platform — Términos](https://cloud.google.com/maps-platform/terms/); [Apple — App Store Review Guidelines 5.1](https://developer.apple.com/app-store/review/guidelines/).*

---

## 3. Marco legal argentino — el motivo de fondo

### 3.a Protección de datos personales (Ley 25.326 + AAIP)

- **La ubicación del vendedor es un dato personal.** La AAIP (autoridad de
  aplicación) fijó expresamente que *"toda información referida a la ubicación de
  una persona y/o sus desplazamientos constituye un dato personal, protegido bajo
  la Ley 25.326"*. Guardar las posiciones asociadas al vendedor es "tratamiento
  de datos" y queda bajo toda la ley — aunque el APK sea interno y el servidor
  sea propio.
- **El corazón del "por qué no": proporcionalidad (art. 4, texto de ley).** Los
  datos deben ser *"adecuados, pertinentes y no excesivos"* respecto de la
  finalidad. Saber dónde está el vendedor **durante una visita/recorrido** es un
  fin legítimo; rastrear su teléfono **lun-vie 8-17 "en todo momento", con la
  pantalla apagada y aun cuando no está haciendo una tarea, es excesivo**, porque
  **ya existe un medio menos invasivo** (el rastreo acotado al recorrido que la
  app tenía). El criterio del "medio menos invasivo" es doctrina de la AAIP (muy
  persuasiva).
- **Rastrear a la persona es peor que rastrear un activo.** Seguir el **teléfono**
  del vendedor sigue a la persona (también cuando almuerza o hace un trámite).
  Un GPS en un **vehículo de la empresa** controla una herramienta de trabajo y
  es más defendible. Nosotros elegimos la opción más invasiva.
- **El consentimiento del empleado es una base frágil (art. 5).** En la relación
  de dependencia hay un desequilibrio de poder que **vicia la libertad del
  consentimiento**: que el vendedor "acepte el permiso" no blinda la práctica.
- **Información veraz (art. 6, texto de ley).** Hay que informar la finalidad real.
  Un permiso que dice **"recorrido"** mientras en realidad se rastrea **toda la
  jornada** es información engañosa y, por sí sola, torna ilícito el tratamiento.
  *(Este es justo un defecto que tenía el proyecto: el texto del permiso seguía
  hablando de "recorrido".)*
- **Hay sanciones.** La AAIP puede apercibir, multar y hasta ordenar la
  cancelación de la base de datos (art. 31). El régimen actualizado (Res.
  240/2022) prevé multas de hasta varios millones de pesos, además del reclamo de
  daños del propio empleado.
- **Rango constitucional.** La privacidad/intimidad está protegida por la
  Constitución (arts. 18, 19 y 43 — hábeas data).

*Fuentes: [Ley 25.326](https://www.argentina.gob.ar/normativa/nacional/64790/texto) (arts. 2, 4, 5, 6, 31); [AAIP — Protección de datos y geolocalización (2020)](https://www.argentina.gob.ar/node/195420); [AAIP Res. 240/2022](https://www.boletinoficial.gob.ar/detalleAviso/primera/277165/20221205); Constitución Nacional, arts. 18, 19 y 43.*

### 3.b Derecho laboral (Ley de Contrato de Trabajo 20.744)

- **El poder de control del empleador es funcional y limitado.** Los arts. 64, 65
  y 68 permiten dirigir y controlar, pero **"sin perjuicio de la preservación de
  los derechos personales del trabajador"**. Vigilar "en todo momento" no responde
  a una exigencia funcional concreta: es vigilancia general de la persona.
- **El control debe ser digno, discreto y CONOCIDO (arts. 70 y 71).** Los sistemas
  de control personal deben *"salvaguardar la dignidad del trabajador"*,
  practicarse *"con discreción"* y ser **"conocidos por el trabajador"**. Un
  rastreo encubierto o con finalidad disfrazada (permiso dice "recorrido",
  rastreo es continuo) **carece de valor probatorio** y **habilita el despido
  indirecto con indemnización** (viola además la buena fe, art. 63).
- **Precedente argentino casi idéntico.** En **"Pavolotzki c/ Fischer Argentina
  S.A." (Cámara Nacional del Trabajo, Sala IX, 2015)**, la empresa puso en los
  celulares de **viajantes** una app que informaba su **ubicación en tiempo
  real**. El tribunal dijo que iba *"más allá de todo límite razonable"*, la
  calificó de **intromisión inadmisible en la intimidad** y respaldó el despido
  indirecto. Es el mismo rubro (vendedores/viajantes) y la misma técnica (app de
  ubicación en el celular).
- **Invade tiempo y espacios no laborales.** Un servicio que corre con la pantalla
  apagada no distingue "trabajo" de vida privada aun dentro de 8-17: capta el
  almuerzo, el trámite personal, el camino a casa. "Horario laboral" no equivale a
  "disponibilidad total para ser geolocalizado".

*Fuentes: [Ley 20.744 (LCT)](http://servicios.infoleg.gob.ar/infolegInternet/anexos/25000-29999/25552/texact.htm) (arts. 63, 64, 65, 68, 70, 71, 72); [CNAT Sala IX, "Pavolotzki c/ Fischer" (2015)](https://repositorio.mpd.gov.ar/documentos/Pavolotzki%20Claudio%20y%20otros%20c.%20Fischer%20Argentina%20SA.pdf); [Geolocalización de trabajadores (abogados.com.ar)](https://abogados.com.ar/geolocalizacion-de-trabajadores/30753).*

---

## 4. Referencia internacional (buenas prácticas)

No es ley argentina directa, pero las autoridades europeas (RGPD/EDPB, CNIL, ICO,
AEPD) van todas en la **misma dirección**, y la ley argentina sigue los mismos
principios:
- El **consentimiento del empleado casi nunca es base válida** (desequilibrio de
  poder) — EDPB/WP29.
- El tratamiento debe ser **necesario, proporcionado y por el medio menos
  intrusivo**; hay que rastrear **la actividad/el activo, no a la persona**.
- La **CNIL (Francia) prohíbe expresamente el rastreo permanente** y exige poder
  **apagarlo en las pausas** y fuera de la jornada.
- Un monitoreo sistemático así exige una **evaluación de impacto previa** y
  **transparencia real** hacia el trabajador.

*Fuentes: [WP29/EDPB — Opinión 2/2017 sobre datos en el trabajo](https://gdpr-text.com/en/guidelines/dataprocessingatwork/); [CNIL — geolocalización de vehículos de empleados](https://www.cnil.fr/fr/la-geolocalisation-des-vehicules-de-salaries); [ICO — Monitoring workers (2023)](https://ico.org.uk/about-the-ico/media-centre/news-and-blogs/2023/10/ico-publishes-guidance-to-ensure-lawful-monitoring-in-the-workplace); [RGPD art. 35 (evaluación de impacto)](https://gdpr-info.eu/art-35-gdpr/).*

---

## 5. Qué SÍ se puede hacer (y qué quedó implementado)

- **Lo que quedó:** el rastreo de ubicación **sólo durante el recorrido de visitas
  activo**, informado al vendedor (y el registro de entrada/salida). Es
  proporcionado, acotado a la tarea y defendible. *(El "modo continuo por jornada"
  que se había construido se revirtió.)*
- **Si en el futuro se quisiera ir más allá**, las condiciones mínimas para
  acercarlo a lo conforme serían: finalidad concreta y legítima; **informar con
  transparencia** (no decir "recorrido" si es otra cosa); **limitar a la tarea**
  y poder **apagarlo en las pausas**; conservar los datos poco tiempo; idealmente
  **rastrear la visita/el vehículo y no a la persona**; hacer una **evaluación de
  impacto**; y **consultarlo con un abogado** antes de activarlo.

---

### Resumen para decir en una reunión

> "Técnicamente se puede, pero no de la forma que queríamos. Android obliga a que
> el empleado **vea** que lo rastreamos (aviso permanente) y lo pueda apagar, así
> que un seguimiento oculto no existe; y encima el teléfono lo corta por batería,
> así que tampoco es confiable. Y legalmente: la ley de datos exige que el control
> **no sea excesivo** y el derecho laboral exige que sea **conocido y digno** —
> rastrear 'en todo momento' no pasa ese filtro, cuando ya alcanza con rastrear el
> recorrido. Hay hasta un fallo (Pavolotzki) que condenó a una empresa por
> exactamente esto. Por eso lo dejamos acotado al recorrido."
