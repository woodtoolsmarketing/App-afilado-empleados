"""
Iconos del panel de escritorio, a partir del logo de la empresa.

Electron necesita dos archivos distintos y por dos motivos distintos:

  recursos/icono.png   el de la ventana, mientras la app corre.
  recursos/icono.ico   el del instalador, del acceso directo y de la barra de
                       tareas. Windows lo quiere en formato ICO y con varias
                       medidas adentro: el explorador elige la que le sirve
                       según dónde lo dibuje. Un ICO de un solo tamaño se ve
                       borroso en la mitad de los lugares.

    python herramientas/generar-iconos.py

Se corre una sola vez, o cuando cambie el logo. Los archivos que genera SÍ van
al repositorio: sin ellos el empaquetado falla, y no tiene sentido que cada
máquina que compile tenga que tener Pillow instalado.
"""

from pathlib import Path

from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
ORIGEN = RAIZ / "Imagenes" / "Logos" / "1.png"
DESTINO = RAIZ / "apps" / "escritorio" / "recursos"

# Las que Windows realmente usa. 256 es la grande del explorador; 16 es la de
# la barra de título.
MEDIDAS_ICO = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def cuadrado(im: Image.Image, lado: int) -> Image.Image:
    """El logo centrado en un lienzo cuadrado y transparente.

    Sin esto, un logo apaisado sale estirado: los iconos son cuadrados y quien
    los dibuja no pregunta.
    """
    copia = im.copy()
    copia.thumbnail((lado, lado), Image.LANCZOS)
    lienzo = Image.new("RGBA", (lado, lado), (0, 0, 0, 0))
    lienzo.paste(copia, ((lado - copia.width) // 2, (lado - copia.height) // 2), copia)
    return lienzo


def main() -> None:
    if not ORIGEN.exists():
        raise SystemExit(f"No está el logo: {ORIGEN}")

    DESTINO.mkdir(parents=True, exist_ok=True)
    logo = Image.open(ORIGEN).convert("RGBA")

    png = cuadrado(logo, 512)
    png.save(DESTINO / "icono.png", "PNG")

    # `sizes` mete todas las medidas en un solo archivo. Pillow se encarga de
    # reescalar desde el más grande.
    cuadrado(logo, 256).save(DESTINO / "icono.ico", "ICO", sizes=MEDIDAS_ICO)

    print(f"  icono.png  512x512")
    print(f"  icono.ico  {', '.join(str(m[0]) for m in MEDIDAS_ICO)}")
    print(f"  en {DESTINO.relative_to(RAIZ)}")


if __name__ == "__main__":
    main()
