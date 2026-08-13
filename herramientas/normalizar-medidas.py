#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Pasa el catálogo técnico (11 listas) al vocabulario de medidas del formulario.

De dónde sale
-------------
El paquete `catalogo-wood-tools-plano` trae, por rubro, un `05-tabla-<cat>.csv`
con las medidas ya parseadas: diámetro, kerf, agujero, dientes, largo, ancho,
espesor, cabo, mano. Eso es justo lo que a `catalogo_articulos` le falta: ahí
las medidas viven adentro de la descripción, como texto, y por eso el renglón
las pedía escritas a mano.

Qué hace
--------
Renombra cada medida al nombre que usa el formulario de la app —`ancho_corte`,
`diametro_exterior`, `cantidad_dientes`…— para que la cascada pueda devolver
"para este campo quedan estos valores" y la pantalla lo enchufe sin traducir
nada. Los dos vocabularios tienen que seguir coincidiendo: si mañana se agrega
un campo al renglón, se agrega también acá.

Qué NO hace
-----------
**No toca precios.** Los precios de la app salen de `catalogo_articulos`, que se
carga de las listas del Gestión Comercial y está más al día que estos PDF —la
lista de mechas del paquete es de julio de 2025 y la de la base es posterior.
Acá sólo viajan medidas, unidas por código.

Uso
---
    python herramientas/normalizar-medidas.py <carpeta-del-paquete>

Escribe `supabase/datos/medidas-tecnicas.json`, que carga
`herramientas/cargar-medidas.cjs`.
"""

import csv
import glob
import json
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SALIDA = os.path.join(RAIZ, 'supabase', 'datos', 'medidas-tecnicas.json')


def num(v):
    """Número o None. Las medidas vacías no son cero: son 'no se publica'."""
    s = str(v or '').strip()
    if not s:
        return None
    try:
        f = float(s)
    except ValueError:
        return None
    return int(f) if f == int(f) else f


def texto(v):
    s = str(v or '').strip()
    return s or None


# ─────────────────────────────────────────────────────────────────────────────
# De qué herramienta del formulario es cada fila
#
# El catálogo técnico se organiza por lista de precios; el formulario, por lo
# que el cliente trae al mostrador. No es lo mismo: dentro de la lista Freud
# conviven sierras e incisoras, y las incisoras son otra herramienta para el
# vendedor —se hermanan, se cotizan distinto y tienen su propio sub-formulario.
# ─────────────────────────────────────────────────────────────────────────────

SUBRUBROS_INCISOR = {'107', '133'}
SUBRUBROS_CABEZAL = {'018', '020', '043', '046', '200'}


def herramienta_de(catalogo, fila):
    sub = str(fila.get('subrubro_codigo') or '').strip()
    familia = str(fila.get('familia') or '').strip()

    if catalogo == 'cuchillas':
        return 'cuchilla'
    if catalogo == 'cuchillas_cabezales':
        return 'cabezal'
    if catalogo == 'sierras_sin_fin':
        return 'sierra_sin_fin'
    if catalogo in ('mechas', 'mechas_portaherramientas'):
        return 'mecha'
    if catalogo in ('fresas', 'fresas_insertos'):
        return 'cabezal' if sub in SUBRUBROS_CABEZAL else 'fresa'
    if catalogo in ('sierras_freud', 'sierras_shark', 'sierras_franzoi'):
        if sub in SUBRUBROS_CABEZAL:
            return 'cabezal'
        # La incisora cónica de Franzoi no tiene sub-rubro propio: la lista la
        # mete con las multiples y sólo el prefijo del código la distingue.
        if sub in SUBRUBROS_INCISOR or familia.startswith('SCC'):
            return 'incisor'
        return 'sierra'
    return None


# ─────────────────────────────────────────────────────────────────────────────
# El renombre: medida del catálogo -> campo del formulario
# ─────────────────────────────────────────────────────────────────────────────

COMUNES = {
    'D_mm': 'diametro_exterior',
    'B_mm': 'ancho_corte',
    'B_mm_cuerpo': 'cuerpo',
    'd_mm': 'diametro_interior',
    'agujero_mm': 'diametro_interior',
    'Z_total': 'cantidad_dientes',
    'platina_mm': 'platina',
    'radio_mm': 'radio',
    'altura_mm': 'altura',
    'altura_diamante_mm': 'altura',
    'largo_mm': 'largo',
    'espesor_mm': 'espesor',
    'largo_total_mm': 'largo_total',
    'largo_util_mm': 'largo_util',
    'cabo_d_mm': 'cabo',
    'aloja_cabo_mm': 'cabo',
    'paso_dentado_mm': 'paso',
}

# `ancho_mm` es la trampa del paquete: en cuchillas y flejes es el ancho de la
# pieza, pero en fresas es el ANCHO DE TRABAJO, que es contra lo que se busca el
# código de cómputo. Mapearlo igual en los dos lados haría que una fresa de 20
# mm de perfil se cotizara como si fuera una cuchilla de 20 mm de alto.
ANCHO_POR_CATALOGO = {
    'fresas': 'ancho_corte',
    'fresas_insertos': 'ancho_corte',
}

# En las mechas el diámetro ES la medida que manda, y el formulario la llama
# `diametro` a secas y no `diametro_exterior`.
DIAMETRO_POR_HERRAMIENTA = {'mecha': 'diametro'}


def convertir(catalogo, fila):
    herramienta = herramienta_de(catalogo, fila)
    if not herramienta:
        return None

    salida = {
        'codigo': fila['codigo'].strip(),
        'herramienta': herramienta,
        'catalogo': catalogo,
        'marca': texto(fila.get('marca')),
        'subrubro': texto(fila.get('subrubro_codigo')),
        'subrubro_nombre': texto(fila.get('subrubro_nombre')),
        'familia': texto(fila.get('familia')),
        'familia_descripcion': texto(fila.get('familia_descripcion')),
        'mano': texto(fila.get('mano')),
        'par_codigo': texto(fila.get('par_codigo')),
        'geometria': texto(fila.get('geometria_diente')),
        'notas': texto(fila.get('notas')),
    }

    for origen, destino in COMUNES.items():
        if origen in fila:
            v = num(fila.get(origen))
            if v is not None and salida.get(destino) is None:
                salida[destino] = v

    if 'ancho_mm' in fila:
        destino = ANCHO_POR_CATALOGO.get(catalogo, 'ancho')
        v = num(fila.get('ancho_mm'))
        if v is not None:
            salida[destino] = v

    if 'diametro_mm' in fila:
        destino = DIAMETRO_POR_HERRAMIENTA.get(herramienta, 'diametro_exterior')
        v = num(fila.get('diametro_mm'))
        if v is not None:
            salida[destino] = v

    # El ancho regulable de las incisoras cónicas ("4.5-5.7") se guarda como
    # rango: buscar 5 mm exactos en una sierra que se regula de 4,5 a 5,7 no
    # devolvería nada, y sin embargo es la que corresponde.
    mn, mx = num(fila.get('B_mm_min')), num(fila.get('B_mm_max'))
    if mn is not None and mx is not None and mn != mx:
        salida['ancho_corte_min'] = mn
        salida['ancho_corte_max'] = mx

    return {k: v for k, v in salida.items() if v is not None}


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit('Falta la carpeta del paquete de catálogos.')

    carpeta = sys.argv[1]
    filas, por_catalogo, por_herramienta = [], {}, {}

    for ruta in sorted(glob.glob(os.path.join(carpeta, '05-tabla-*.csv'))):
        catalogo = os.path.basename(ruta)[len('05-tabla-'):-len('.csv')]
        if catalogo == 'servicios':
            # Los servicios no son una herramienta que el cliente trae: son el
            # trabajo que se le hace. Ya viven en `catalogo_articulos` con su
            # rango de medidas y su precio.
            continue
        with open(ruta, encoding='utf-8-sig', newline='') as fh:
            for fila in csv.DictReader(fh, delimiter=';'):
                convertida = convertir(catalogo, fila)
                if not convertida:
                    continue
                filas.append(convertida)
                por_catalogo[catalogo] = por_catalogo.get(catalogo, 0) + 1
                h = convertida['herramienta']
                por_herramienta[h] = por_herramienta.get(h, 0) + 1

    repetidos = [c for c, n in
                 __import__('collections').Counter(f['codigo'] for f in filas).items() if n > 1]
    if repetidos:
        raise SystemExit(f'Códigos repetidos entre catálogos: {", ".join(repetidos)}')

    os.makedirs(os.path.dirname(SALIDA), exist_ok=True)
    with open(SALIDA, 'w', encoding='utf-8') as fh:
        json.dump(filas, fh, ensure_ascii=False, separators=(',', ':'))

    print(f'{len(filas)} códigos -> {os.path.relpath(SALIDA, RAIZ)}')
    print('\nPor lista:')
    for c, n in sorted(por_catalogo.items()):
        print(f'  {c:28} {n:4}')
    print('\nPor herramienta del formulario:')
    for h, n in sorted(por_herramienta.items(), key=lambda kv: -kv[1]):
        print(f'  {h:16} {n:4}')


if __name__ == '__main__':
    main()
