# Recursos gráficos

⚠️ **Los cuatro PNG de esta carpeta están vacíos.** Son archivos válidos pero sin
contenido, para que el proyecto compile mientras llegan los originales de la
marca. Hay que reemplazarlos antes de compilar la versión que se reparte.

Tres son **transparentes**: el fondo rojo lo pone la app (`app.config.ts`), así
que hoy se ven simplemente como fondo. El cuarto, `icono.png`, es rojo sólido
porque un ícono de launcher transparente Android lo pinta de negro.

En pantalla, mientras tanto, el logo aparece como un recuadro blanco vacío en el
encabezado y en el login. Ese recuadro **es parte del diseño** (así se ve en los
mockups, porque el logo de WoodTools viene sobre fondo blanco): cuando pongas el
PNG real, encaja solo.

| Archivo | Tamaño | Qué es |
|---|---|---|
| `logo-woodtools.png` | 1024×400, fondo transparente | Logo del encabezado y del login. Va sobre fondo blanco, así que conviene el logo a color con el escudo. |
| `icono.png` | 1024×1024, sin transparencia | Ícono de la app. Sin margen: Android lo recorta solo. |
| `icono-adaptativo.png` | 1024×1024 | Capa frontal del ícono adaptativo. Dejá un **25 % de margen** en cada lado: Android recorta hasta un círculo. El fondo lo pone `app.config.ts` (`#B30F0F`). |
| `splash.png` | 1284×2778 | Pantalla de arranque. Se muestra centrada sobre fondo rojo, así que alcanza con el logo en el centro y transparencia alrededor. |

Después de reemplazarlos:

```bash
cd apps/movil
npx expo prebuild --platform android --clean
```
