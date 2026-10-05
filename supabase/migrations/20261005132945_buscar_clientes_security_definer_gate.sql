-- Búsqueda de clientes: se hace SECURITY DEFINER para no evaluar RLS fila por fila.
--
-- El problema real del timeout no era la consulta sino la RLS: con la función en
-- SECURITY INVOKER, el `clientes_leer` llama a interno.esta_habilitado()/es_admin()
-- /puede_ver_todo() —que consultan `perfiles`— UNA VEZ POR FILA en cualquier
-- escaneo secuencial. Una búsqueda que no cae en un índice (un número de 1-2
-- dígitos, o un OR que mezcla código indexado con `like '%...%'`) escanea las
-- 16.600 fichas y tarda ~6 s, arriba del statement_timeout de 8 s → HTTP 500.
-- (Se veía en la app como "No pudimos buscar [object Object]".)
--
-- La solución: la función corre como su dueño (bypassa RLS) y hace el control de
-- acceso UNA sola vez, con la MISMA regla que la policy:
--   · habilitado o "puede ver todo" (admin/supervisor) → ve los clientes activos;
--   · cualquier otro (anónimo, suspendido, pendiente) → no ve nada.
-- Es exactamente lo que devolvía la RLS (un vendedor habilitado ve todos los
-- clientes activos), pero el chequeo se hace una vez en vez de 16.600 veces.
-- auth.uid() sigue siendo el del que llama: SECURITY DEFINER cambia el rol, no el
-- JWT de la request, así que esta_habilitado() identifica bien al vendedor.
--
-- La lógica de match, las columnas, el join a direcciones y el orden quedan
-- IGUALES que antes: sólo cambia que ahora es rápida siempre.
create or replace function public.buscar_clientes(p_texto text, p_limite integer default 15)
returns table(cliente_id uuid, codigo text, razon_social text, nombre_fantasia text, cuit text, contacto_nombre text, telefono text, email text, provisorio boolean, vendedor_id uuid, direccion_id uuid, direccion text, codigo_postal text, lat double precision, lng double precision, localidad text, provincia text)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with q as (
    select
      btrim(regexp_replace(
        regexp_replace(interno.normalizar_busqueda(p_texto), '[^a-z0-9 ]', '', 'g'),
        '\s+', ' ', 'g')) as t,
      regexp_replace(coalesce(p_texto, ''), '[^0-9]', '', 'g') as digitos
  ),
  p as (
    select
      q.t,
      q.digitos,
      array_remove(string_to_array(q.t, ' '), '') as palabras,
      (select w from unnest(string_to_array(q.t, ' ')) w
        where w <> '' order by length(w) desc, w limit 1) as mayor,
      case when length(q.digitos) >= 3 then '%' || q.digitos || '%' end as pat_cuit,
      case when length(q.digitos) >= 6 then '%' || right(q.digitos, 6) || '%' end as pat_tel
    from q
  )
  select
    c.id, c.codigo, c.razon_social, c.nombre_fantasia, c.cuit,
    c.contacto_nombre, c.telefono, c.email, c.provisorio, c.vendedor_id,
    d.id,
    coalesce(d.direccion_formateada, c.direccion),
    coalesce(d.codigo_postal, c.codigo_postal),
    d.lat, d.lng,
    coalesce(d.localidad, c.localidad),
    d.provincia
  from public.clientes c
  cross join p
  left join lateral (
    select * from public.direcciones dd
     where dd.cliente_id = c.id
     order by dd.principal desc, dd.creado_en
     limit 1
  ) d on true
  -- Control de acceso, UNA vez (subconsulta escalar = InitPlan). Misma regla que
  -- la policy clientes_leer para lo que esta búsqueda devuelve (clientes activos).
  where (select interno.esta_habilitado() or interno.puede_ver_todo())
    and c.activo
    and (
      (
        p.mayor is not null
        and c.busqueda_plana like '%' || p.mayor || '%'
        and not exists (
          select 1 from unnest(p.palabras) w
           where c.busqueda_plana not like '%' || w || '%'
        )
      )
      or regexp_replace(coalesce(c.cuit, ''), '[^0-9]', '', 'g') like p.pat_cuit
      or regexp_replace(
           regexp_replace(
             regexp_replace(coalesce(c.telefono, ''), '[ ()+.-]', '', 'g'),
             '([0-9]{6})[^0-9]+', '\1 ', 'g'),
           '[^0-9 ]', '', 'g')
         like p.pat_tel
    )
  order by
    (c.codigo = btrim(coalesce(p_texto, ''))) desc,
    (p.pat_cuit is not null
      and regexp_replace(coalesce(c.cuit, ''), '[^0-9]', '', 'g') <> ''
      and regexp_replace(coalesce(c.cuit, ''), '[^0-9]', '', 'g') = p.digitos) desc,
    (c.codigo like btrim(coalesce(p_texto, '')) || '%') desc,
    (c.busqueda_plana like p.t || '%') desc,
    (case
       when p.t ~ '^[0-9]+$'
       then c.busqueda_plana ~ ('(^|[^0-9])' || p.t || '([^0-9]|$)')
     end) desc,
    (c.codigo like '%' || btrim(coalesce(p_texto, '')) || '%') desc,
    case
      when c.codigo like '%' || btrim(coalesce(p_texto, '')) || '%'
      then lpad(c.codigo, 8, '0')
    end,
    c.razon_social,
    lpad(c.codigo, 8, '0')
  limit least(coalesce(p_limite, 15), 50);
$function$;

-- Función SECURITY DEFINER que lee clientes salteando RLS: que la ejecuten sólo
-- los roles que la app usa logueada. El anónimo no busca clientes.
revoke execute on function public.buscar_clientes(text, integer) from public, anon;
