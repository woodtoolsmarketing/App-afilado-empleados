# Recursos gráficos

Los cuatro PNG **se generan** a partir del logo de la empresa
(`Imagenes/Logos/1.png`). No se editan a mano:

```bash
python herramientas/generar-recursos-movil.py
```

| Archivo | Tamaño | Qué es |
|---|---|---|
| `logo-woodtools.png` | 1024×400, transparente | Logo del encabezado y del login. La app ya lo dibuja sobre un recuadro blanco. |
| `icono.png` | 1024×1024, fondo blanco | Ícono de la app. Sin transparencia: Android la pinta de negro. |
| `icono-adaptativo.png` | 1024×1024, transparente | Capa frontal del ícono adaptativo, con margen porque Android la recorta hasta un círculo. El fondo lo pone `app.config.ts`. |
| `splash.png` | 1284×2778, transparente | Pantalla de arranque: el logo adentro de un panel blanco, para que se lea sobre el rojo. |

## Por qué el fondo es blanco y no rojo

El logo tiene el texto en negro y la sierra en rojo y gris, y está hecho para
fondo claro. Sobre el rojo de la marca (`#B30F0F`) el texto desaparece y la
sierra se confunde con el fondo. Por eso el ícono va sobre blanco, el fondo del
ícono adaptativo también, y en la pantalla de arranque el logo va adentro de un
panel blanco redondeado — el mismo recurso visual que usa el login.

## Si cambia el logo

Se reemplaza `Imagenes/Logos/1.png`, se vuelve a correr el script y se
recompila. Si ya existe la carpeta `android/`, hace falta además:

```bash
cd apps/movil
npx expo prebuild --platform android --clean
```
