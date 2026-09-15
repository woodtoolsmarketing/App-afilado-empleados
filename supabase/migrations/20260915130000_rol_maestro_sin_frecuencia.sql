-- =============================================================================
-- El rol maestro deja de exigir "cada cuántos días", y la búsqueda por
-- localidad usa índice.
--
-- ── Por qué ─────────────────────────────────────────────────────────────────
--
-- El rol maestro se carga de un Excel de la oficina, y esos Excel son planillas
-- de recorrido por día/zona: traen el código del cliente y la razón social,
-- pero NO una frecuencia de visita. Exigirla obligaba a inventar un número que
-- nadie tenía, y en la práctica hacía que el archivo entero se rechazara.
--
-- Así que la frecuencia pasa a ser opcional: el rol maestro es "la lista de
-- clientes de este vendedor". Cuando un cliente no tiene frecuencia, aparece
-- como candidato siempre (mientras no esté ya en la ruta de hoy), y el vendedor
-- decide. Los clientes que SÍ tengan una frecuencia cargada siguen andando
-- igual que antes: la condición vieja se conserva y sólo se le agrega el caso
-- del nulo.
-- =============================================================================

-- La columna ya no es obligatoria. El CHECK `between 1 and 365` se deja como
-- está: un NULL lo pasa (la comparación da NULL, y un CHECK sólo rechaza cuando
-- da FALSE), así que no hay que tocarlo.
alter table public.rol_maestro
  alter column cada_cuantos_dias drop not null;

comment on column public.rol_maestro.cada_cuantos_dias is
  'Cada cuantos dias visitar al cliente. Opcional: si esta en NULL, el cliente es candidato siempre (el Excel de recorrido no trae frecuencia).';

-- ─────────────────────────────────────────────────────────────────────────────
-- candidatos_del_dia: un cliente sin frecuencia es candidato siempre.
--
-- Antes: candidato si nunca se lo visitó, o si pasaron >= cada_cuantos_dias
-- desde la última visita. Con la frecuencia en NULL esa cuenta daba NULL y el
-- cliente ya visitado no volvía a aparecer NUNCA. Se agrega el caso del nulo y
-- nada más; lo demás queda igual.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.candidatos_del_dia(p_vendedor_id uuid default null)
returns table(
  cliente_id uuid, codigo text, razon_social text, direccion text,
  lat double precision, lng double precision, cada_cuantos_dias integer,
  ultima_visita date, dias_desde integer, orden integer
)
language sql
stable
set search_path to 'public', 'pg_temp'
as $fn$
  with quien as (select coalesce(p_vendedor_id, auth.uid()) as id),
  ultimas as (
    select v.cliente_id, max(rv.fecha) as fecha
      from public.visitas v
      join public.roles_visita rv on rv.id = v.rol_visita_id
     where v.visitado
       and v.cliente_id is not null
     group by v.cliente_id
  ),
  ya_en_ruta as (
    select distinct pa.cliente_id
      from public.paradas pa
      join public.roles_visita rv on rv.id = pa.rol_visita_id
      join quien q on q.id = rv.vendedor_id
     where rv.fecha = current_date
       and pa.cliente_id is not null
  )
  select
    c.id,
    c.codigo,
    c.razon_social,
    d.direccion_formateada,
    d.lat,
    d.lng,
    rm.cada_cuantos_dias,
    u.fecha,
    case when u.fecha is null then null
         else (current_date - u.fecha)::int end,
    rm.orden
  from public.rol_maestro rm
  join quien q on q.id = rm.vendedor_id
  join public.clientes c on c.id = rm.cliente_id
  left join lateral (
    select dd.direccion_formateada, dd.lat, dd.lng
      from public.direcciones dd
     where dd.cliente_id = c.id
     order by dd.principal desc, dd.creado_en
     limit 1
  ) d on true
  left join ultimas u on u.cliente_id = c.id
  where rm.activo
    and c.activo
    and (u.fecha is null or rm.cada_cuantos_dias is null or current_date - u.fecha >= rm.cada_cuantos_dias)
    and not exists (select 1 from ya_en_ruta r where r.cliente_id = c.id)
  order by rm.orden nulls last, u.fecha nulls first, c.razon_social;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Buscar clientes por localidad, con índice.
--
-- El buscador del panel (Clientes) compara la palabra tipeada contra
-- `localidad` con un `ilike '%...%'`. Sin un índice que sirva para el comodín
-- de adelante, eso barre los 16.496 clientes en cada tecla: es la lentitud que
-- se siente al buscar. Un GIN de trigramas —el mismo tipo que ya usa
-- `busqueda_plana`— resuelve el `ilike` por índice.
-- ─────────────────────────────────────────────────────────────────────────────
create index if not exists clientes_localidad_trgm_idx
  on public.clientes using gin (localidad extensions.gin_trgm_ops);
