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

# Variante del codigo, separada por un espacio: "FI14M AA3", "TM06M AD3".
#
# NO es parte de la descripcion: cada variante es un articulo distinto con su
# propio precio. TM06M tiene cinco (AB3 924, AD3 1254.75, AH3 1645.77,
# AL3 2310, CG3 1686.30) y quedarse con el codigo base dejaba UNO solo, con lo
# cual cuatro de cada cinco cotizaciones salian con el precio de otra pieza.
#
# La forma sale de los datos, no de una suposicion: "AA3", "A080", "1900",
# "FA5A", "45LG3", "110A". Es el segundo codigo de la ficha Freud.
#
# Tres reglas, y las tres hacen falta:
#   · 3 a 5 caracteres alfanumericos, sin puntos  -> deja afuera "S.C.",
#     "S.C.I.", "S.C.DIAM", "INS.", que son el arranque de la descripcion
#   · al menos un digito                          -> deja afuera "CH", "SOP"
#   · solo mayusculas y digitos                   -> deja afuera "Cab.",
#     "Afilado", "Mecha", que son descripciones en minuscula
VARIANTE = re.compile(r"^(?=[A-Z0-9]*\d)[A-Z0-9]{3,5}$")

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

# Listas cuyo encabezado declara una moneda EQUIVOCADA. Pisa al encabezado, asi
# que cada entrada necesita evidencia, no una impresion.
#
# CABEZALES INSERTOS dice "En Pesos" y esta en dolares. Comparte 172 codigos con
# CABEZALES FREUD, que declara dolares, y la razon entre los precios de los dos
# archivos va de 1,000 a 1,307 (mediana 1,27): es la misma lista con un aumento
# del 27%. Si una estuviera en pesos la razon rondaria 1500. Tomarla como pesos
# cotizaba un cabezal de USD 227 a $237.
MONEDA_CORREGIDA = {
    "CABEZALES INSERTOS": "USD",
}

# Listas sin fecha en el nombre y con fecha establecida por otro medio.
#
# CABEZALES INSERTOS: la fecha de modificacion del PDF es 2026-03-20, el mismo
# dia que CUCHILLAS 200326, AFIL MECHAS 200326 y AFILADOS SC FRESAS INSERTOS
# 200326. Es una tanda que el Gestion exporto junta y a esta le falto la fecha
# en el nombre; no es un dato adivinado.
FECHA_CONFIRMADA = {
    "CABEZALES INSERTOS": "2026-03-20",
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
R_HASTA  = re.compile(r"\bHASTA\s+#?(\d+(?:[.,]\d+)?)", re.I)
R_MAYOR  = re.compile(r"\bMAYOR\s+A\s+d?=?\s*(\d+(?:[.,]\d+)?)", re.I)
# "d=150" habla de diametro, no de ancho de corte. Son dimensiones distintas y
# confundirlas elegiria el codigo de otra herramienta.
R_DIAM   = re.compile(r"\bd\s*=", re.I)


def normalizar(texto: str) -> str:
    """Arregla los caracteres que el Gestión escribe con otro juego.

    La "Ý" es la Ø —el diámetro— en la codificación con la que exporta el
    Gestión Comercial. Esto ya se hacía, pero **sólo sobre el campo `medida`**,
    y la descripción salía sin corregir: 40 artículos entraron al catálogo con
    "S.C. Ý=250" en vez de "S.C. Ø=250".

    No era cosmético. El diámetro exterior se lee del texto de la descripción,
    así que esos artículos quedaban sin diámetro: sin características que
    mostrar en el buscador y sin forma de reconocer la herramienta que trae el
    cliente.
    """
    return texto.replace("Ý", "Ø").strip()


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
    """
    Devuelve (codigo, resto).

    Contempla dos formas que trae el Gestion Comercial:

      · el codigo pegado a la descripcion  -> "MB225158300Muela"
      · el codigo con variante             -> "FI14M AA3"

    La variante va PEGADA al codigo, separada por un espacio, y es parte del
    codigo: identifica una pieza distinta con su propio precio.
    """
    if not textos:
        return None, []

    primero = textos[0]
    if CODIGO.match(primero):
        if len(textos) > 1 and VARIANTE.match(textos[1]):
            return f"{primero} {textos[1]}", textos[2:]
        return primero, textos[1:]

    m = PEGADO.match(primero)
    if m:
        return m.group(1), [m.group(2)] + textos[1:]

    return None, textos


# Una fila de medidas es corta y esta hecha de numeros con separadores:
# "100x30x3", "D=150 B=1.5 d=30 Z=18", "Ø=4mm L=58mm CABO=10x20".
MEDIDA_SUELTA = re.compile(r"^[^A-Za-z]*\d")


# Palabras que SI aparecen en una medida y no la descalifican.
PALABRAS_DE_MEDIDA = re.compile(r"\b(mm|MM|CABO|min|max|LARGO|ANCHO|ESP)\b")


def es_medida(linea):
    """
    Distingue una medida de un pedazo de descripcion.

    Una medida es casi toda numeros y separadores: "100x30x3",
    "D=150 B=1.5 d=30 Z=18", "Ø=4mm L=58mm CABO=10x20". Las letras que
    aparecen son rotulos de una sola letra (D, B, d, Z, H, L) o unidades.

    El corte es la corrida de tres o mas letras seguidas: "DER/IZQ.(LI200)"
    tiene digitos y una barra, y sin este chequeo entraba como medida —
    pisando la medida de verdad, que venia en la fila siguiente, y dejando dos
    articulos distintos con la misma clave.
    """
    t = linea.strip()
    if not t or len(t) > 60:
        return False
    if re.match(r"^(Rubro|Sub-rubro|Total|Pagina|Hoja)\b", t, re.IGNORECASE):
        return False
    if not re.search(r"\d", t):
        return False
    if re.search(r"[A-Za-z]{3,}", PALABRAS_DE_MEDIDA.sub("", t)):
        return False
    return bool(re.search(r"[x×/=]|mm|MM|Ø|Ý", t)) or bool(MEDIDA_SUELTA.match(t))


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


def moneda_corregida(nombre_lista):
    """La que pisa al encabezado cuando el encabezado esta mal. Ver la tabla."""
    for clave, moneda in MONEDA_CORREGIDA.items():
        if clave in nombre_lista.upper():
            return moneda
    return None


def procesar(pdf_path):
    articulos = []
    precios_en_pdf = 0

    familia = familia_de(pdf_path.stem)

    with pdfplumber.open(str(pdf_path)) as pdf:
        declarada = detectar_moneda(pdf)
        # La correccion gana: son los casos donde el encabezado miente y
        # esta demostrado. Si no, manda el encabezado.
        moneda = moneda_corregida(pdf_path.stem) or declarada or moneda_confirmada(pdf_path.stem)
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
                    # ── La fila de MEDIDAS ────────────────────────────────────
                    #
                    # En estas listas las medidas van en su propia fila, debajo
                    # de la del articulo y sin precio:
                    #
                    #   CHC030100HSS | CUCHILLA PARA CEPILLAR HSS 18% | 11,63
                    #   100x30x3
                    #
                    # Descartar toda fila sin precio, que es lo que se hacia,
                    # tiraba 1.049 renglones de medidas: las cuchillas, las
                    # sierras sin fin y las mechas quedaban sin una sola medida
                    # cargada, que son justo las que el vendedor necesita para
                    # reconocer la herramienta.
                    if articulos and not articulos[-1]["medida"] and es_medida(linea):
                        articulos[-1]["medida"] = normalizar(linea)
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
                texto = normalizar(" ".join(resto))
                if not texto:
                    continue

                # La medida puede venir al final de la misma linea. Se pasa por
                # el mismo filtro que la fila suelta: sin eso, "DER/IZQ.(LI200)"
                # entraba como medida y tapaba la de la fila de abajo.
                medida = None
                if (
                    resto
                    and len(resto) > 1
                    and resto[-2].upper() not in {"A", "DE", "HASTA"}
                    and re.search(r"[x×/]|mm|MM", resto[-1])
                    and es_medida(resto[-1])
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
                        "lista_fecha": fecha_de_lista(pdf_path.stem, pdf_path),
                        "fecha_estimada": not FECHA_ARCHIVO.search(pdf_path.stem)
                        and not any(k in pdf_path.stem.upper() for k in FECHA_CONFIRMADA),
                    }
                )

    return articulos, precios_en_pdf, declarada


# La fecha va en el nombre del archivo, en cualquiera de estas formas:
#   "...020626"  "...10-07-25"  "...22-5--26"  "...07-08-23"
# Es el dato que decide cual edicion de un codigo es la vigente, asi que una
# lista sin fecha reconocible tiene que saltar a la vista y no quedar en NULL
# silenciosamente.
FECHA_ARCHIVO = re.compile(r"(\d{1,2})[-\s]*(\d{1,2})[-\s]*-*(\d{2})(?!\d)|(\d{2})(\d{2})(\d{2})$")


def fecha_de_lista(nombre, ruta=None):
    """
    La fecha de la lista, en ISO.

    Sale del nombre del archivo. Cuando el nombre no la trae —le pasa a
    "LISTA PRECIO CABEZALES INSERTOS"— se usa la fecha de modificacion del PDF,
    que es lo unico que queda. Es un dato que decide cual edicion de un codigo
    gana, asi que el caso se avisa por pantalla para que alguien renombre el
    archivo con su fecha.
    """
    for clave, fecha in FECHA_CONFIRMADA.items():
        if clave in nombre.upper():
            return fecha

    m = FECHA_ARCHIVO.search(nombre.strip())
    if not m:
        if ruta is not None:
            import datetime

            return datetime.date.fromtimestamp(ruta.stat().st_mtime).isoformat()
        return None
    if m.group(4):
        dia, mes, anio = m.group(4), m.group(5), m.group(6)
    else:
        dia, mes, anio = m.group(1), m.group(2), m.group(3)
    try:
        d, mm, aa = int(dia), int(mes), int(anio)
    except ValueError:
        return None
    if not (1 <= d <= 31 and 1 <= mm <= 12):
        return None
    return f"20{aa:02d}-{mm:02d}-{d:02d}"


def escapar(v):
    if v is None or v == "":
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def escribir_sql(articulos, destino):
    """
    Arma la migracion con el catalogo entero.

    Reemplaza la tabla completa en vez de hacer un merge: las listas se
    reemplazan enteras cuando el Gestion las reemite, y un merge dejaria
    conviviendo articulos viejos que ya no existen con los nuevos.
    """
    lineas = [
        "-- " + "=" * 75,
        "-- WoodTools · Paso 2 · Datos del catálogo de precios",
        "--",
        "-- Generado por herramientas/extraer_listas.py desde las 19 listas en PDF del",
        f"-- Gestión Comercial. {len(articulos)} renglones, "
        f"{len(set(a['codigo'] for a in articulos))} códigos.",
        "--",
        "-- NO editar a mano. Al cambiar las listas, volver a correr el extractor.",
        "-- " + "=" * 75,
        "",
        "-- ── La clave de un artículo ─────────────────────────────────────────────",
        "--",
        "-- Era (codigo, lista_origen). No alcanza: la lista de HERRAMIENTAS DE",
        "-- DIAMANTE repite el mismo código para dos productos distintos y lo único",
        "-- que los diferencia es la altura del diente, que va en la medida:",
        "--",
        "--   SCCD150322  Ø=125-200 B=3.2-4.2 Z=24 H=4   USD 1.164,00",
        "--   SCCD150322  Ø=125-200 B=3.2-4.2 Z=24 H=5   USD 1.450,00",
        "--",
        "-- Con la clave vieja uno de los dos se perdía. Son 14 casos, todos dentro",
        "-- de la misma lista: ningún código aparece repetido entre listas distintas,",
        "-- así que sumar la medida a la clave no arrastra ediciones viejas.",
        "alter table public.catalogo_articulos",
        "  add column if not exists fecha_estimada boolean not null default false;",
        "alter table public.catalogo_articulos",
        "  drop constraint if exists catalogo_articulos_codigo_lista_origen_key;",
        "drop index if exists public.catalogo_articulo_unico;",
        "create unique index catalogo_articulo_unico",
        "  on public.catalogo_articulos (codigo, lista_origen, coalesce(medida, ''));",
        "",
        "delete from public.catalogo_articulos;",
        "",
        "insert into public.catalogo_articulos "
        "(codigo,descripcion,medida,precio,moneda,lista_origen,lista_fecha,familia,"
        "rango_min,rango_max,rango_dimension,fecha_estimada) values",
    ]

    filas = []
    for a in articulos:
        filas.append(
            "("
            + ",".join(
                [
                    escapar(a["codigo"]),
                    escapar(a["descripcion"]),
                    escapar(a["medida"]),
                    repr(float(a["precio"])),
                    escapar(a["moneda"]),
                    escapar(a["lista"]),
                    escapar(a["lista_fecha"]),
                    escapar(a["familia"]),
                    "NULL" if a["rango_min"] is None else repr(float(a["rango_min"])),
                    "NULL" if a["rango_max"] is None else repr(float(a["rango_max"])),
                    escapar(a["rango_dimension"]),
                    "true" if a["fecha_estimada"] else "false",
                ]
            )
            + ")"
        )
    lineas.append(",\n".join(filas) + ";")

    # Lo derivado se recalcula acá mismo. Si viviera en otra migración, un
    # recargado del catálogo dejaría los artículos nuevos sin clasificar y el
    # buscador volvería a ofrecerle códigos de reparación a un afilado.
    lineas.append(
        """
-- ── Clasificación por servicio y herramienta ─────────────────────────────────
--
-- La familia `afilado_general` mezcla afilado y reparación, y adentro de cada
-- grupo hay unos de sierra y otros de fresa. Está en el texto, no en columnas.
update public.catalogo_articulos set
  servicio_sugerido = case
    when descripcion ~* '^(afil|afilado)' then 'afilado'
    when descripcion ~* '^rep'            then 'reparacion'
    when descripcion ~* 'rectific'        then 'rectificado'
    when descripcion ~* 'herman'          then 'hermanado'
    when descripcion ~* 'rebaj'           then 'rebaje'
  end,
  herramienta_sugerida = case
    when descripcion ~* '(^|[^A-Z])(S\\.?C\\.?([^A-Z]|$)|SIERRA)'   then 'sierra'
    when descripcion ~* 'FRESA|(^|[^A-Z])FR\\.'                    then 'fresa'
    when descripcion ~* 'INCISOR'                                 then 'incisor'
    when descripcion ~* '(^|[^A-Z])CB([^A-Z]|$)|CABEZAL'          then 'cabezal'
  end
where familia = 'afilado_general';

-- ── La edición vigente de cada código ────────────────────────────────────────
--
-- `nulls last` no es cosmético: una lista sin fecha en el nombre le ganaba a
-- una fechada, y hay códigos que están en las dos con MONEDAS distintas. El
-- resultado era cotizar en pesos algo que la lista vigente tiene en dólares.
-- Se agrupa por codigo Y medida, por el mismo motivo que la clave: con
-- `distinct on (codigo)` a secas, de los dos SCCD150322 el buscador mostraba
-- uno solo y el vendedor no tenia forma de llegar al otro.
drop view if exists public.vista_catalogo_vigente cascade;
create view public.vista_catalogo_vigente
with (security_invoker = true) as
select distinct on (codigo, coalesce(medida, ''))
  id, codigo, descripcion, medida, precio, moneda, precio_a_confirmar,
  familia, rango_min, rango_max, rango_dimension, lista_origen, lista_fecha,
  servicio_sugerido, herramienta_sugerida
from public.catalogo_articulos
order by codigo, coalesce(medida, ''),
         -- Primero las listas que traen su fecha en el nombre: una fecha
         -- deducida del archivo no puede decidir que precio se cotiza.
         fecha_estimada, lista_fecha desc nulls last, creado_en desc;
"""
    )

    destino.write_text("\n".join(lineas) + "\n", encoding="utf-8")


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

    sin_fecha = sorted({a["lista"] for a in todo if not a["lista_fecha"]})
    if sin_fecha:
        print("\n  <-- SIN FECHA EN EL NOMBRE (no se puede saber cuál es la vigente):")
        for x in sin_fecha:
            print(f"        {x}")

    if len(sys.argv) > 1 and sys.argv[1] == "--sql":
        destino = pathlib.Path(sys.argv[2])
        escribir_sql(todo, destino)
        print(f"\n  SQL escrito en {destino}")
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
