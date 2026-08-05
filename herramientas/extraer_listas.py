"""
Extractor de las listas de precios de WoodTools.

Los PDF son exportaciones del "Gestion Comercial". El texto NO se puede leer
linea por linea: en varios archivos sale por columnas (todos los codigos, despues
todas las descripciones, despues todos los precios), asi que un parser ingenuo
aparea el precio con el producto equivocado. Por eso se reconstruyen las filas
por coordenada Y con pdfplumber.

Dos rarezas del formato que costaron encontrar:
  1. El precio a veces cae en una banda vertical apenas distinta de la del
     codigo, asi que la fila se agrupa por el punto medio del texto y con una
     tolerancia proporcional a la altura de la fuente, no por el borde superior.
  2. En algunas listas el codigo viene pegado a la descripcion sin espacio
     (MB225158300Muela de Borazon), asi que hay que separarlos por patron.

La cobertura se mide contra la cantidad de precios que hay en el PDF: es el
unico numero que dice cuantos articulos deberia haber.
"""

import json
import pathlib
import re
import sys

import pdfplumber

sys.stdout.reconfigure(encoding="utf-8")

BASE = pathlib.Path(r"V:\DPTO VENTAS\LIsta Precios WT\Lista Completa Vigente")
SALIDA = pathlib.Path("catalogo.json")

PRECIO = re.compile(r"^-?[\d.]+,\d{2}$")
CODIGO = re.compile(r"^[A-Z0-9][A-Z0-9._/-]{2,24}$")
# Codigo pegado a la descripcion: "MB225158300Muela" -> "MB225158300" + "Muela"
PEGADO = re.compile(r"^([A-Z0-9][A-Z0-9._/-]*?\d)([A-Z][a-z].*)$")

# El encabezado de cada lista declara la moneda. Es CRITICO: 10 de las 19
# listas estan en dolares. Tomarlas como pesos cotizaria una cuchilla de
# USD 11,63 como $11,63.
MONEDA = re.compile(r"Precios\s+(?:sin|con)\s+I\.V\.A\.\s+En\s+(Pesos|Dolares|D.lares)", re.IGNORECASE)

# Listas cuyo encabezado NO declara la moneda y que el cliente confirmo aparte.
# MUELAS es la unica de las 19: los valores (204 a 356 por una muela de
# diamante) tampoco dejaban lugar a dudas.
#
# Solo se consulta cuando el PDF no la trae. El encabezado siempre manda, para
# que un cambio en la lista no quede tapado por esta tabla.
MONEDA_CONFIRMADA = {
    "MUELAS": "USD",
}

RUIDO = re.compile(
    r"Gestion Comercial|WOOD TOOLS|LISTA DE PRECIOS|Ordenada por|Precios sin|"
    r"Cod\.Selec|Producto:|Hoja:|Fecha:",
    re.IGNORECASE,
)

# ── Rangos de medida ────────────────────────────────────────────────────────
#
# Confirmado con el cliente: "#3 A 4mm" es el rango de ancho de corte en mm, y
# de ahi sale el codigo de computo.
#
# Solo se interpretan en las listas de SERVICIO. En las de venta, "1/2 A 3/4"
# son pulgadas (radio de una fresa), no un rango de milimetros: tomarlo como
# rango daria un codigo equivocado.
FAMILIAS_CON_RANGO = {"afilado_general", "sierra_sin_fin", "mecha", "cuchilla"}

FRACCION = re.compile(r"\d\s*/\s*\d")
R_ENTRE  = re.compile(r"#?(\d+(?:[.,]\d+)?)\s*(?:mm)?\s+[Aa]\s+#?(\d+(?:[.,]\d+)?)\s*(?:mm)?", re.I)
R_HASTA  = re.compile(r"HASTA\s+#?(\d+(?:[.,]\d+)?)", re.I)
R_MAYOR  = re.compile(r"MAYOR\s+A\s+d?=?\s*(\d+(?:[.,]\d+)?)", re.I)
# "d=150" habla de diametro, no de ancho de corte. Son dimensiones distintas y
# confundirlas elegiria el codigo de otra herramienta.
R_DIAM   = re.compile(r"d\s*=", re.I)


def _num(s):
    return float(s.replace(",", "."))


def parsear_rango(descripcion, familia):
    """(minimo, maximo, dimension) o None si no hay un rango confiable."""
    if not descripcion or familia not in FAMILIAS_CON_RANGO:
        return None
    if FRACCION.search(descripcion):
        return None

    dimension = "diametro" if R_DIAM.search(descripcion) else "ancho_corte"

    m = R_MAYOR.search(descripcion)
    if m:
        return (_num(m.group(1)), None, dimension)

    m = R_HASTA.search(descripcion)
    if m:
        return (0.0, _num(m.group(1)), dimension)

    m = R_ENTRE.search(descripcion)
    if m:
        a, b = _num(m.group(1)), _num(m.group(2))
        # Un rango invertido o desmesurado no es una medida: es otra cosa.
        if b < a or b > 500:
            return None
        return (a, b, dimension)

    return None


FAMILIAS = [
    ("AFIL MECHAS", "mecha"), ("AFIL MEHAS", "mecha"), ("MECHAS", "mecha"),
    ("AFIL SSF", "sierra_sin_fin"), ("SSF CARBONO", "sierra_sin_fin"),
    ("SSF UDDELHOM", "sierra_sin_fin"), ("CUCHILLAS", "cuchilla"),
    ("FRESAS WT", "fresa"), ("CABEZALES", "cabezal"), ("SIERRA FREUD", "sierra"),
    ("MUELAS", "muela"), ("HTAS DIAMANTE", "diamante"),
    ("AFIL Y REP", "afilado_general"),
    ("AFILADOS SC FRESAS INSERTOS", "afilado_general"),
]


def familia_de(lista):
    for clave, valor in FAMILIAS:
        if clave in lista:
            return valor
    return "varios"


# Palabras que delatan un renglon de encabezado de columna.
ENCABEZADO = {"Código", "Codigo", "Descripción", "Descripcion", "Precio"}


def filas_de_pagina(pagina):
    """Agrupa palabras en renglones por el punto medio vertical del texto."""
    palabras = pagina.extract_words(use_text_flow=False, keep_blank_chars=False)
    if not palabras:
        return []

    # Tolerancia proporcional a la altura tipica del texto de la pagina.
    alturas = [w["bottom"] - w["top"] for w in palabras]
    alturas.sort()
    alto = alturas[len(alturas) // 2] or 8
    tol = alto * 0.6

    palabras.sort(key=lambda w: (w["top"] + w["bottom"]) / 2)
    filas, actual, centro_actual = [], [], None

    for w in palabras:
        centro = (w["top"] + w["bottom"]) / 2
        if centro_actual is None or abs(centro - centro_actual) <= tol:
            actual.append(w)
            centro_actual = centro if centro_actual is None else centro_actual
        else:
            filas.append(sorted(actual, key=lambda x: x["x0"]))
            actual, centro_actual = [w], centro
    if actual:
        filas.append(sorted(actual, key=lambda x: x["x0"]))
    return filas


def separar_codigo(textos):
    """Devuelve (codigo, resto) contemplando el codigo pegado a la descripcion."""
    if not textos:
        return None, []

    primero = textos[0]
    if CODIGO.match(primero):
        return primero, textos[1:]

    m = PEGADO.match(primero)
    if m:
        return m.group(1), [m.group(2)] + textos[1:]

    return None, textos


def detectar_moneda(pdf):
    """Lee la moneda del encabezado. None si la lista no la declara."""
    for pagina in pdf.pages[:2]:
        texto = pagina.extract_text() or ""
        m = MONEDA.search(texto)
        if m:
            return "ARS" if m.group(1).lower().startswith("peso") else "USD"
    return None


def moneda_confirmada(nombre_lista):
    """La que confirmo el cliente para las listas que no la declaran."""
    for clave, moneda in MONEDA_CONFIRMADA.items():
        if clave in nombre_lista.upper():
            return moneda
    return None


def procesar(pdf_path):
    articulos = []
    precios_en_pdf = 0

    familia = familia_de(pdf_path.stem)

    with pdfplumber.open(str(pdf_path)) as pdf:
        declarada = detectar_moneda(pdf)
        moneda = declarada or moneda_confirmada(pdf_path.stem)
        for pagina in pdf.pages:
            for w in pagina.extract_words():
                if PRECIO.match(w["text"]):
                    precios_en_pdf += 1

            for fila in filas_de_pagina(pagina):
                textos = [w["text"] for w in fila]
                linea = " ".join(textos)

                if RUIDO.search(linea) or ENCABEZADO & set(textos):
                    continue

                indices = [i for i, t in enumerate(textos) if PRECIO.match(t)]
                if not indices:
                    continue
                i_precio = indices[-1]

                codigo, resto = separar_codigo(textos[:i_precio])
                if not codigo:
                    continue

                precio = float(textos[i_precio].replace(".", "").replace(",", "."))

                # El texto completo se conserva SIEMPRE. Varias listas expresan
                # rangos partidos en dos ("REP.PARCIAL DTE. S.C. #3 A" + "4mm"
                # = "de #3 a 4mm"); separar la medida a ciegas partia el rango
                # al medio y perdia el limite inferior.
                texto = " ".join(resto).strip()
                if not texto:
                    continue

                medida = None
                if (
                    resto
                    and len(resto) > 1
                    and resto[-2].upper() not in {"A", "DE", "HASTA"}
                    and re.search(r"\d", resto[-1])
                    and re.search(r"[x×/]|mm|MM", resto[-1])
                ):
                    medida = resto[-1]

                descripcion = texto

                rango = parsear_rango(descripcion, familia)

                articulos.append(
                    {
                        "codigo": codigo,
                        "descripcion": descripcion,
                        "medida": medida,
                        "precio": precio,
                        "moneda": moneda,
                        "familia": familia,
                        "rango_min": rango[0] if rango else None,
                        "rango_max": rango[1] if rango else None,
                        "rango_dimension": rango[2] if rango else None,
                        "lista": pdf_path.stem,
                    }
                )

    return articulos, precios_en_pdf, declarada


def main():
    todo = []
    total_precios = 0
    print(f'{"ARCHIVO":<44} {"ARTIC":>6} {"COB":>6} {"MON":>5} {"$0":>6}')
    print("-" * 78)

    for pdf in sorted(BASE.glob("*.PDF")):
        try:
            arts, precios, declarada = procesar(pdf)
        except Exception as e:  # noqa: BLE001
            print(f"{pdf.stem[:50]:<50} ERROR {e}")
            continue
        todo.extend(arts)
        total_precios += precios
        cob = f"{100 * len(arts) / precios:.0f}%" if precios else "-"
        mon = arts[0]["moneda"] if arts else "-"
        ceros = sum(1 for a in arts if a["precio"] == 0)
        alerta = ""
        if mon is None:
            alerta = "  <-- NO DECLARA MONEDA"
        elif declarada is None:
            # Salio de MONEDA_CONFIRMADA, no del PDF. Conviene que se vea: si la
            # lista algun dia declara otra cosa, hay que borrar la entrada.
            alerta = "  <-- moneda confirmada aparte, el PDF no la declara"
        elif precios and len(arts) / precios < 0.95:
            alerta = "  <-- COBERTURA BAJA"
        print(f"{pdf.stem[:44]:<44} {len(arts):>6} {cob:>6} {str(mon):>5} {ceros:>6}{alerta}")

    SALIDA.write_text(json.dumps(todo, ensure_ascii=False, indent=1), encoding="utf-8")
    print("-" * 78)
    cob = f"{100 * len(todo) / total_precios:.1f}%" if total_precios else "-"
    usd = sum(1 for a in todo if a["moneda"] == "USD")
    ars = sum(1 for a in todo if a["moneda"] == "ARS")
    sin = sum(1 for a in todo if a["moneda"] is None)
    print(f'{"TOTAL":<44} {len(todo):>6} {cob:>6}')
    print(f"\n  En pesos: {ars}   En dolares: {usd}   Sin declarar: {sin}")
    print(f"  Con precio 0,00: {sum(1 for a in todo if a['precio'] == 0)}")
    print(f"  Con rango de medida: {sum(1 for a in todo if a['rango_min'] is not None)}")
    print(f"\nCodigos unicos: {len({a['codigo'] for a in todo})}")


if __name__ == "__main__":
    main()
