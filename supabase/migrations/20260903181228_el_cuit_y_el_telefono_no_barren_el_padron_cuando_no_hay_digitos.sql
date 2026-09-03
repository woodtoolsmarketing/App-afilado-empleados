-- =============================================================================
-- El CUIT y el teléfono dejan de barrer el padrón cuando no se tipeó un número
--
-- La migración 20260903163158 puso guardas para que las ramas de CUIT y de
-- teléfono no calcularan sus regexp si el vendedor no había tipeado dígitos:
--
--     length(p.digitos) >= 3 and regexp_replace(c.cuit, ...) like '%'||p.digitos||'%'
--
-- Esa guarda funciona sólo si Postgres puede resolver `length(p.digitos) >= 3`
-- cuando arma el plan. Y adentro de una función el texto es un PARÁMETRO: si el
-- plan que quedó en el caché es el genérico, no hay valor que plegar, la guarda
-- no descarta nada y las tres ramas del OR quedan vivas. Ahí aparece el
-- problema de verdad: con `p.digitos` vacío, el patrón queda `like '%%'`, que
-- le coincide a TODAS las filas. El BitmapOr une entonces los tres índices y el
-- del CUIT y el del teléfono aportan las 12.181 filas cada uno.
--
-- Medido, con el mismo texto y la misma base, sobre "carpinteria torres":
--
--     plan a medida (el que se ve tipeando la consulta a mano)      3,2 ms
--     plan genérico (el que usa la app)                           368,0 ms
--
--     Bitmap Index Scan clientes_busqueda_plana_idx      →    308 filas
--     Bitmap Index Scan clientes_cuit_digitos_idx        → 12.181 filas
--     Bitmap Index Scan clientes_telefono_normal_idx     → 12.181 filas
--     Rows Removed by Filter: 12.179
--
-- Por eso los 8 ms y los 98 ms que anota la migración anterior no eran los que
-- sentía el vendedor: están medidos con el texto escrito como literal, que es
-- el único caso en que la guarda se pliega.
--
-- ── Lo que cambia ───────────────────────────────────────────────────────────
--
-- La guarda deja de ser una condición al lado del LIKE y pasa a ser el patrón
-- mismo: si no hay dígitos suficientes, el patrón es NULL. `algo like NULL` da
-- NULL, que en un OR no matchea, y —esto es lo que importa— el recorrido del
-- índice con la clave en NULL devuelve cero filas sin recorrer nada.
--
-- No depende de que el planificador adivine nada: vale igual con plan genérico
-- y con plan a medida. Y las ramas siguen queriendo decir lo mismo: tres
-- dígitos para el CUIT, seis para el teléfono.
--
-- Medido después del cambio, forzando el plan genérico —el caso malo—:
--
--     "carpinteria torres"    368,0 ms  →  16,7 ms
--     clientes_cuit_digitos_idx      12.181 filas  →  0
--     clientes_telefono_normal_idx   12.181 filas  →  0
--
-- Se probó antes `alter function ... set plan_cache_mode = 'force_custom_plan'`,
-- que sería el atajo. No sirve: no cambia cómo se planifica el cuerpo de una
-- función SQL. Medido, quedó en 369,7 ms contra los 364,0 de antes. Queda
-- escrito para que nadie lo intente por ese camino.
-- =============================================================================

create or replace function public.buscar_clientes(p_texto text, p_limite integer default 15)
returns table (
  cliente_id uuid, codigo text, razon_social text, nombre_fantasia text, cuit text,
  contacto_nombre text, telefono text, email text, provisorio boolean, vendedor_id uuid,
  direccion_id uuid, direccion text, codigo_postal text, lat double precision,
  lng double precision, localidad text, provincia text
)
language sql
stable
set search_path to 'public', 'pg_temp'
as $fn$
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
      -- La palabra más larga es la que se le pide al índice: es la que menos
      -- filas devuelve. Las demás filtran después, sobre esas pocas.
      (select w from unnest(string_to_array(q.t, ' ')) w
        where w <> '' order by length(w) desc, w limit 1) as mayor,
      -- Sin dígitos suficientes el patrón es NULL, y un índice con la clave en
      -- NULL no devuelve nada. Es la guarda, puesta donde el plan genérico
      -- también la respeta.
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
  where c.activo
    and (
      -- Todas las palabras, en cualquier orden, contra el nombre ya guardado
      -- en minúsculas, sin acentos y sin puntuación.
      (
        p.mayor is not null
        and c.busqueda_plana like '%' || p.mayor || '%'
        and not exists (
          select 1 from unnest(p.palabras) w
           where c.busqueda_plana not like '%' || w || '%'
        )
      )
      -- Tres dígitos o más: puede ser un CUIT.
      or regexp_replace(coalesce(c.cuit, ''), '[^0-9]', '', 'g') like p.pat_cuit
      -- Seis o más: puede ser un teléfono, y se busca por los últimos seis.
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
$fn$;

comment on function public.buscar_clientes(text, integer) is
  'Busca por codigo, razon social, nombre de fantasia, CUIT o telefono. El texto se normaliza —sin acentos, sin puntuacion, espacios colapsados— y se exigen TODAS las palabras en cualquier orden.';

grant execute on function public.buscar_clientes(text, integer) to authenticated;
