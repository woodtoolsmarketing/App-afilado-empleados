-- ─────────────────────────────────────────────────────────────────────────────
-- Las medidas técnicas de cada código, con el vocabulario del formulario
--
-- `catalogo_articulos` tiene el código, la descripción y el precio, pero las
-- medidas viven **adentro de la descripción, como texto**: "S.C. D=300 B=3.2
-- d=30 Z=36". Sirve para imprimir y para nada más. Por eso el renglón las pedía
-- escritas a mano, y no había forma de contestar la pregunta que el vendedor se
-- hace de verdad: "elegí 300 mm, ¿qué cantidades de dientes existen?".
--
-- Esta tabla es la otra mitad: una fila por código con las medidas ya separadas
-- en columnas, y con **los mismos nombres que los campos del renglón**
-- (`ancho_corte`, `diametro_exterior`, `cantidad_dientes`…). Esa coincidencia
-- no es casual: permite que la cascada devuelva las opciones indexadas por
-- nombre de campo y que la pantalla las enchufe sin traducir nada.
--
-- Los datos salen del paquete de catálogos técnicos, normalizados por
-- `herramientas/normalizar-medidas.py` y cargados por
-- `herramientas/cargar-medidas.cjs` (npm run cargar:medidas).
--
-- **No hay precios acá, y es a propósito.** Los precios son de
-- `catalogo_articulos`, que se carga de las listas del Gestión Comercial y está
-- más al día que los PDF del paquete —la lista de mechas del paquete es de
-- julio de 2025 y la de la base es posterior—. Se unen por código.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.catalogo_medidas (
  codigo               text primary key,
  herramienta          text not null check (herramienta in
                         ('sierra','fresa','cabezal','incisor','sierra_sin_fin','mecha','cuchilla')),
  catalogo             text not null,
  marca                text,
  subrubro             text,
  subrubro_nombre      text,
  familia              text,
  familia_descripcion  text,
  mano                 text,
  par_codigo           text,
  geometria            text,
  notas                text,

  diametro_exterior    numeric,
  ancho_corte          numeric,
  -- El ancho regulable de las incisoras cónicas ("4.5-5.7") es un rango: buscar
  -- 5,0 exactos no encontraría la que sirve.
  ancho_corte_min      numeric,
  ancho_corte_max      numeric,
  cuerpo               numeric,
  diametro_interior    numeric,
  cantidad_dientes     integer,
  platina              numeric,
  radio                numeric,
  altura               numeric,
  largo                numeric,
  ancho                numeric,
  espesor              numeric,
  largo_total          numeric,
  largo_util           numeric,
  cabo                 numeric,
  paso                 numeric,
  diametro             numeric,

  actualizado_en       timestamptz not null default now()
);

create index if not exists catalogo_medidas_herramienta_idx on public.catalogo_medidas (herramienta);
create index if not exists catalogo_medidas_sierra_idx
  on public.catalogo_medidas (herramienta, diametro_exterior, cantidad_dientes, ancho_corte);
create index if not exists catalogo_medidas_cuchilla_idx
  on public.catalogo_medidas (herramienta, largo, ancho, espesor);
create index if not exists catalogo_medidas_mecha_idx
  on public.catalogo_medidas (herramienta, diametro, largo_total);

comment on table public.catalogo_medidas is
  'Medidas tecnicas por codigo, con los nombres de campo del renglon. Alimenta la cascada de medidas. Los precios salen de catalogo_articulos.';

alter table public.catalogo_medidas enable row level security;

drop policy if exists "medidas lectura habilitados" on public.catalogo_medidas;
create policy "medidas lectura habilitados" on public.catalogo_medidas
  for select to authenticated using (interno.esta_habilitado());

drop policy if exists "medidas escritura admin" on public.catalogo_medidas;
create policy "medidas escritura admin" on public.catalogo_medidas
  for all to authenticated using (interno.es_admin()) with check (interno.es_admin());
