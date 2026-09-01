-- =============================================================================
-- REPORTAR UN PROBLEMA, desde la calle y con el contexto puesto.
--
-- Hasta hoy, cuando algo fallaba en el medio de una visita el vendedor llamaba
-- por telefono, contaba lo que se acordaba, y del otro lado alguien anotaba en
-- un papel. Lo que se perdia en ese camino no era el relato: era la version de
-- la app, el codigo del telefono, el modelo y cuando pasa. Sin esas cuatro
-- cosas un problema no se puede reproducir, y lo que no se puede reproducir no
-- se arregla: queda como "a veces se traba".
--
-- El segundo campo del mockup —"cuando suele darse el problema"— se pidio que
-- fuera aprendiendo de los reportes anteriores. Por eso el reporte se guarda
-- entero en vez de mandarse por mensaje: `cuando_se_da_frecuente` lee lo que
-- ya contestaron los demas y se lo ofrece hecho al que esta reportando ahora.
-- Escribir "cuando abro una nota" veinte veces con veinte redacciones
-- distintas es lo que impide contar que son veinte veces la misma cosa.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Los problemas que se reportan desde la calle
-- ─────────────────────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'estado_reporte') then
    create type public.estado_reporte as enum ('nuevo', 'en_revision', 'resuelto', 'descartado');
  end if;
end
$$;

create table if not exists public.reportes_problema (
  id             uuid primary key default extensions.gen_random_uuid(),
  vendedor_id    uuid not null references public.perfiles (id) on delete cascade,

  /*
   * El motivo elegido del desplegable. Es TEXTO y no un enum a proposito:
   * la lista de motivos va a crecer con lo que se reporte, y agregar uno no
   * puede costar una migracion. Los rotulos viven en el paquete compartido,
   * que es lo que ven el telefono y el panel.
   */
  motivo         text not null,
  /* Lo que escribio cuando eligio "Otro", o el detalle que quiso agregar. */
  detalle        text,
  /* El segundo campo del mockup: cuando suele darse. */
  cuando_se_da   text,

  /* Contexto que el vendedor no tiene por que saber contar. */
  pantalla       text,
  version_app    text,
  instalacion    text,
  modelo         text,

  estado         estado_reporte not null default 'nuevo',
  respuesta      text,
  atendido_por   uuid references public.perfiles (id) on delete set null,
  atendido_en    timestamptz,

  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  constraint reportes_problema_motivo_no_vacio check (length(btrim(motivo)) > 0)
);

comment on table public.reportes_problema is
  'Problemas reportados desde la app. Los mira Marketing, que es quien los resuelve.';

create index if not exists reportes_problema_pendientes_idx
  on public.reportes_problema (creado_en desc)
  where estado in ('nuevo', 'en_revision');

create index if not exists reportes_problema_vendedor_idx
  on public.reportes_problema (vendedor_id, creado_en desc);

alter table public.reportes_problema enable row level security;

-- El vendedor reporta lo suyo y ve lo suyo: tiene que poder mirar si ya aviso
-- de esto, y si le contestaron.
drop policy if exists reportes_problema_crear_propio on public.reportes_problema;
create policy reportes_problema_crear_propio on public.reportes_problema
  for insert to authenticated
  with check (vendedor_id = auth.uid() and interno.esta_habilitado());

drop policy if exists reportes_problema_leer on public.reportes_problema;
create policy reportes_problema_leer on public.reportes_problema
  for select to authenticated
  using (interno.puede_ver_todo() or vendedor_id = auth.uid());

-- Cerrar un reporte es de la oficina. El que lo abrio no lo cierra.
drop policy if exists reportes_problema_admin on public.reportes_problema;
create policy reportes_problema_admin on public.reportes_problema
  for all to authenticated
  using (interno.es_admin()) with check (interno.es_admin());

drop trigger if exists reportes_problema_tocar_actualizado on public.reportes_problema;
create trigger reportes_problema_tocar_actualizado
  before update on public.reportes_problema
  for each row execute function interno.tocar_actualizado_en();


/*
 * Guardar un reporte.
 *
 * Es una funcion y no un insert directo por una sola razon: el vendedor_id lo
 * pone el servidor. Desde el telefono no hay forma de reportar en nombre de
 * otro, ni por error ni a proposito.
 */
create or replace function public.reportar_problema(
  p_motivo       text,
  p_detalle      text default null,
  p_cuando_se_da text default null,
  p_pantalla     text default null,
  p_version_app  text default null,
  p_instalacion  text default null,
  p_modelo       text default null
)
returns public.reportes_problema
language plpgsql
security invoker
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare
  guardado public.reportes_problema;
begin
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Elegi cual es el problema antes de enviarlo.'
      using errcode = '23514';
  end if;

  insert into public.reportes_problema (
    vendedor_id, motivo, detalle, cuando_se_da,
    pantalla, version_app, instalacion, modelo
  )
  values (
    auth.uid(),
    btrim(p_motivo),
    nullif(btrim(coalesce(p_detalle, '')), ''),
    nullif(btrim(coalesce(p_cuando_se_da, '')), ''),
    nullif(btrim(coalesce(p_pantalla, '')), ''),
    nullif(btrim(coalesce(p_version_app, '')), ''),
    nullif(btrim(coalesce(p_instalacion, '')), ''),
    nullif(btrim(coalesce(p_modelo, '')), '')
  )
  returning * into guardado;

  return guardado;
end;
$fn$;

comment on function public.reportar_problema is
  'Guarda un problema reportado desde la app. El vendedor sale de la sesion, no del parametro.';

grant execute on function public.reportar_problema(text, text, text, text, text, text, text)
  to authenticated;


/*
 * El desplegable que aprende.
 *
 * Devuelve las respuestas de "cuando suele darse" que mas se repitieron, para
 * ofrecerlas hechas. Es exactamente lo que pidio el mockup y ademas es lo que
 * hace utiles a los reportes: si veinte personas escriben la misma frase con
 * veinte redacciones distintas, no hay forma de contarlas.
 *
 * Se comparan sin mayusculas ni tildes y se devuelve la redaccion mas usada de
 * cada grupo, para que lo que se ofrece este escrito como lo escribe la gente.
 * Se piden dos apariciones minimo: una respuesta suelta que escribio una sola
 * persona no es una opcion, es el caso raro de esa persona.
 */
create or replace function public.cuando_se_da_frecuente(
  p_motivo text default null,
  p_limite int default 8
)
returns table (texto text, veces bigint)
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $fn$
  -- Las columnas de adentro NO se llaman `texto` ni `veces` a proposito: esos
  -- son los nombres de las columnas que devuelve la funcion, y en una funcion
  -- SQL esos nombres son parametros. Repetirlos adentro hace que Postgres no
  -- sepa si uno se refiere al parametro o a la columna, y aborta.
  with dichas as (
    select
      btrim(r.cuando_se_da) as frase,
      -- Sin tildes y en minusculas, a mano: la extension `unaccent` no esta
      -- instalada en este proyecto y no vale la pena instalarla para esto.
      lower(translate(btrim(r.cuando_se_da),
                      'áéíóúüñÁÉÍÓÚÜÑ',
                      'aeiouunAEIOUUN')) as clave
    from public.reportes_problema r
    where r.cuando_se_da is not null
      and length(btrim(r.cuando_se_da)) between 3 and 120
      and (p_motivo is null or r.motivo = p_motivo)
  ),
  agrupadas as (
    select
      d.clave,
      count(*) as repeticiones,
      (array_agg(d.frase order by d.frase))[1] as frase
    from dichas d
    group by d.clave
  )
  select a.frase, a.repeticiones
    from agrupadas a
   where a.repeticiones >= 2
   order by a.repeticiones desc, a.frase
   limit least(coalesce(p_limite, 8), 30);
$fn$;

comment on function public.cuando_se_da_frecuente is
  'Las respuestas de "cuando suele darse" que ya escribieron otros, para ofrecerlas hechas.';

grant execute on function public.cuando_se_da_frecuente(text, int) to authenticated;
