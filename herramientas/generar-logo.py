"""
Convierte el logo de la marca en el modulo que usa la impresion.

El talonario se imprime desde tres lados —la app, el panel y el probador— y en
dos de ellos no hay sistema de archivos ni red al momento de armar el HTML. Por
eso el logo va embebido como data URI en el paquete compartido: si dependiera de
un archivo, la nota saldria sin logo justo cuando el vendedor esta parado frente
a la impresora.

Se recorta el borde blanco y se achica a 360 px de ancho: en el papel ocupa
24 mm de alto, que a 300 dpi son unos 280 px. Guardar los 500x500 originales
serian 148 KB de base64 en todos los bundles para imprimirlo a un tercio.

    python herramientas/generar-logo.py
"""

import base64
import io
import pathlib

from PIL import Image

RAIZ = pathlib.Path(__file__).resolve().parent.parent
ORIGEN = RAIZ / "Imagenes" / "Logos" / "1.png"
DESTINO = RAIZ / "packages" / "compartido" / "src" / "logo.ts"

ANCHO = 360

img = Image.open(ORIGEN).convert("RGBA")

# El PNG viene con un marco blanco enorme. Se recorta contra el fondo real
# (el pixel de la esquina), no contra transparente: este archivo no la tiene.
fondo = Image.new("RGBA", img.size, img.getpixel((0, 0)))
from PIL import ImageChops  # noqa: E402

caja = ImageChops.difference(img, fondo).convert("L").point(lambda p: 255 if p > 12 else 0).getbbox()
if caja:
    img = img.crop(caja)

alto = round(img.height * ANCHO / img.width)
img = img.resize((ANCHO, alto), Image.LANCZOS)

# Sobre papel el fondo es blanco: aplanar evita que una impresora resuelva el
# alfa en gris y saque el logo sucio.
plano = Image.new("RGB", img.size, (255, 255, 255))
plano.paste(img, mask=img.split()[3])

buf = io.BytesIO()
plano.save(buf, format="PNG", optimize=True)
datos = buf.getvalue()
b64 = base64.b64encode(datos).decode("ascii")

DESTINO.write_text(
    '/**\n'
    ' * Logo de WoodTools, embebido.\n'
    ' *\n'
    ' * Va como data URI y no como archivo porque el HTML del talonario se arma\n'
    ' * en el teléfono y en el navegador, donde no hay disco ni red garantizados.\n'
    ' * Un logo que depende de una descarga es un logo que falta justo cuando el\n'
    ' * vendedor está parado frente a la impresora.\n'
    ' *\n'
    ' * NO editar a mano: lo genera `python herramientas/generar-logo.py` desde\n'
    f' * Imagenes/Logos/1.png, recortado y a {ANCHO} px de ancho.\n'
    ' */\n'
    f"export const LOGO_WOODTOOLS = 'data:image/png;base64,{b64}'\n",
    encoding="utf-8",
)

print(f"{ORIGEN.name}: {ORIGEN.stat().st_size / 1024:.0f} KB  ->  {len(datos) / 1024:.0f} KB")
print(f"  recortado y redimensionado a {img.width}x{img.height}")
print(f"  escrito en {DESTINO.relative_to(RAIZ)}  ({len(b64) / 1024:.0f} KB de base64)")
