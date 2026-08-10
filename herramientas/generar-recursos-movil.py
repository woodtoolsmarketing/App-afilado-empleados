"""
Los cuatro PNG de la app del celular, a partir del logo de la empresa.

    python herramientas/generar-recursos-movil.py

Se corre una sola vez, o cuando cambie el logo. Lo que genera SÍ va al
repositorio: sin estos archivos el APK sale con el ícono y el logo en blanco, y
no tiene sentido que cada máquina que compile necesite tener Pillow instalado.

─── Por qué no es un simple "achicar y guardar" ──────────────────────────────

El logo tiene el texto en negro y la sierra en rojo y gris, y está pensado para
fondo blanco. La app es roja (#B30F0F). Puesto de cualquier manera sobre ese
fondo, el texto desaparece y la sierra se confunde con el color de atrás.

Así que cada pieza resuelve eso a su modo:

  logo-woodtools.png    transparente. La app ya lo dibuja sobre un recuadro
                        blanco, en el encabezado y en el login.
  icono.png             fondo BLANCO, no rojo. Es el ícono del launcher, que no
                        admite transparencia —Android la pinta de negro— y en
                        rojo el logo no se leería.
  icono-adaptativo.png  transparente y con margen: Android recorta esta capa
                        hasta un círculo, y lo que quede afuera se pierde.
  splash.png            el logo adentro de un panel blanco redondeado, para que
                        se lea sobre el rojo del arranque. Es el mismo recurso
                        visual que usa la pantalla de login.
"""

from pathlib import Path

from PIL import Image, ImageDraw

RAIZ = Path(__file__).resolve().parent.parent
ORIGEN = RAIZ / "Imagenes" / "Logos" / "1.png"
DESTINO = RAIZ / "apps" / "movil" / "assets"

BLANCO = (255, 255, 255, 255)


def logo_recortado() -> Image.Image:
    """El logo sin el aire transparente que trae alrededor.

    Sin recortar, ese margen invisible cuenta como parte de la imagen y todo lo
    que se calcule después —centrados, márgenes— queda corrido.
    """
    im = Image.open(ORIGEN).convert("RGBA")
    caja = im.getbbox()
    return im.crop(caja) if caja else im


def encajar(logo: Image.Image, ancho: int, alto: int) -> Image.Image:
    """El logo lo más grande posible adentro de ese rectángulo, sin deformarlo.

    Se calcula la escala a mano en vez de usar `thumbnail`, que sólo achica:
    el logo original mide 457×255 y los lienzos son de mil y pico de lado, así
    que `thumbnail` lo dejaba tal cual, perdido en el medio de un ícono vacío.
    """
    escala = min(ancho / logo.width, alto / logo.height)
    return logo.resize(
        (max(1, round(logo.width * escala)), max(1, round(logo.height * escala))),
        Image.LANCZOS,
    )


def centrado(logo: Image.Image, lienzo: Image.Image) -> Image.Image:
    lienzo.paste(
        logo,
        ((lienzo.width - logo.width) // 2, (lienzo.height - logo.height) // 2),
        logo,
    )
    return lienzo


def main() -> None:
    if not ORIGEN.exists():
        raise SystemExit(f"No está el logo: {ORIGEN}")

    DESTINO.mkdir(parents=True, exist_ok=True)
    logo = logo_recortado()

    # ── Encabezado y login ───────────────────────────────────────────────────
    # Va sobre el recuadro blanco que ya dibuja la app, así que transparente y
    # con un respiro para que no toque los bordes.
    lienzo = Image.new("RGBA", (1024, 400), (0, 0, 0, 0))
    centrado(encajar(logo, 960, 360), lienzo).save(DESTINO / "logo-woodtools.png", "PNG")

    # ── Ícono del launcher ───────────────────────────────────────────────────
    # Blanco y opaco. Android no admite transparencia acá, y sobre el rojo de la
    # marca el texto negro del logo no se leería.
    icono = Image.new("RGBA", (1024, 1024), BLANCO)
    centrado(encajar(logo, 880, 620), icono).convert("RGB").save(DESTINO / "icono.png", "PNG")

    # ── Capa frontal del ícono adaptativo ────────────────────────────────────
    # Android la recorta hasta un círculo, así que todo tiene que entrar en el
    # 66 % central. El fondo lo pone app.config.ts.
    adaptativo = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    centrado(encajar(logo, 620, 440), adaptativo).save(DESTINO / "icono-adaptativo.png", "PNG")

    # ── Pantalla de arranque ─────────────────────────────────────────────────
    # Sobre fondo rojo, así que el logo va adentro de un panel blanco: es el
    # mismo recurso que usa el login, y sin él el logo no se leería.
    splash = Image.new("RGBA", (1284, 2778), (0, 0, 0, 0))
    panel_ancho, panel_alto, radio = 1000, 460, 48
    panel = Image.new("RGBA", (panel_ancho, panel_alto), (0, 0, 0, 0))
    ImageDraw.Draw(panel).rounded_rectangle(
        (0, 0, panel_ancho - 1, panel_alto - 1), radius=radio, fill=BLANCO
    )
    centrado(encajar(logo, panel_ancho - 120, panel_alto - 120), panel)
    centrado(panel, splash).save(DESTINO / "splash.png", "PNG")

    for archivo in ("logo-woodtools.png", "icono.png", "icono-adaptativo.png", "splash.png"):
        ruta = DESTINO / archivo
        with Image.open(ruta) as im:
            print(f"  {archivo:22} {im.size[0]}x{im.size[1]}  {ruta.stat().st_size // 1024} KB")
    print(f"  en {DESTINO.relative_to(RAIZ)}")


if __name__ == "__main__":
    main()
