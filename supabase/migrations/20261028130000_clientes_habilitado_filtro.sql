-- Filtro de clientes habilitados.
--
-- En la app móvil el vendedor sólo ve/usa clientes `habilitado`. La oficina
-- (interno.puede_ver_todo(): admin / supervisor / administracion) sigue viendo
-- a todos, tanto en el panel como en las pantallas de admin del teléfono.
--
-- El predicado nuevo —`(c.habilitado or (select interno.puede_ver_todo()))`—
-- va envuelto en `(select ...)` a propósito: así la función de sesión se evalúa
-- UNA vez y no por fila (ver la nota de rls-por-fila que satura la base).
--
-- Se tocan las tres funciones de LECTURA que un vendedor usa para encontrar
-- clientes (buscar_clientes, clientes_en_mapa, ficha_cliente) y la confirmación
-- de un provisorio, que ahora deja al cliente habilitado de una.

-- ── buscar_clientes ──────────────────────────────────────────────────────────
-- Igual que la versión difusa (20261006141731), con el filtro de habilitado
-- sumado justo después de `c.activo`.
--
-- Forzar la carga de pg_trgm en esta sesión: su librería registra el GUC
-- pg_trgm.word_similarity_threshold recién al primer uso, y sin el GUC
-- registrado, fijarlo en la config de la función (abajo) pide superusuario.
do $$ begin perform extensions.word_similarity('a', 'a'); end $$;

create or replace function public.buscar_clientes(p_texto text, p_limite integer default 15)
returns table(cliente_id uuid, codigo text, razon_social text, nombre_fantasia text, cuit text, contacto_nombre text, telefono text, email text, provisorio boolean, vendedor_id uuid, direccion_id uuid, direccion text, codigo_postal text, lat double precision, lng double precision, localidad text, provincia text)
language sql
stable security definer
set search_path to 'public', 'pg_temp'
set "pg_trgm.word_similarity_threshold" to '0.4'
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
  where (select interno.esta_habilitado() or interno.puede_ver_todo())
    and c.activo
    and (c.habilitado or (select interno.puede_ver_todo()))
    and (not c.provisorio or (select interno.puede_ver_todo()))
    and (
      -- 1) EXACTO: cada palabra del nombre, como substring (lo de siempre).
      (
        p.mayor is not null
        and c.busqueda_plana like '%' || p.mayor || '%'
        and not exists (
          select 1 from unnest(p.palabras) w
           where c.busqueda_plana not like '%' || w || '%'
        )
      )
      -- 2) DIFUSO: tolera errores de tipeo y variantes. Se ancla en la palabra
      --    más larga (índice GIN, operador %> de pg_trgm) y exige que CADA
      --    palabra de 3+ letras esté como substring o se parezca bastante al
      --    nombre (word_similarity >= 0.5). Sólo para consultas con letras.
      or (
        p.t ~ '[a-z]'
        and p.mayor is not null and length(p.mayor) >= 4
        and c.busqueda_plana operator(extensions.%>) p.mayor
        and not exists (
          select 1 from unnest(p.palabras) w
           where length(w) >= 3
             and c.busqueda_plana not like '%' || w || '%'
             and extensions.word_similarity(w, c.busqueda_plana) < 0.5
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
    -- coincidencia exacta de nombre por encima de la difusa
    (p.mayor is not null and c.busqueda_plana like '%' || p.mayor || '%'
      and not exists (select 1 from unnest(p.palabras) w where c.busqueda_plana not like '%' || w || '%')) desc,
    -- entre las difusas, la más parecida primero
    extensions.word_similarity(p.t, c.busqueda_plana) desc,
    case
      when c.codigo like '%' || btrim(coalesce(p_texto, '')) || '%'
      then lpad(c.codigo, 8, '0')
    end,
    c.razon_social,
    lpad(c.codigo, 8, '0')
  limit least(coalesce(p_limite, 15), 50);
$function$;

-- ── clientes_en_mapa ─────────────────────────────────────────────────────────
-- Igual que 20260925170542, con el filtro de habilitado en el where interno.
create or replace function public.clientes_en_mapa()
returns jsonb
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select case when interno.esta_habilitado() then (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'codigo', t.codigo,
          'razon_social', t.razon_social,
          'lat', t.lat,
          'lng', t.lng
        )
      ),
      '[]'::jsonb
    )
    from (
      select distinct on (c.id)
        c.id, c.codigo, c.razon_social, d.lat, d.lng
      from public.clientes c
      join public.direcciones d on d.cliente_id = c.id
      where c.activo
        and (c.habilitado or (select interno.puede_ver_todo()))
        and d.lat is not null
        and d.lng is not null
      order by c.id, d.principal desc, d.creado_en
    ) t
  ) else '[]'::jsonb end;
$function$;

-- ── ficha_cliente ────────────────────────────────────────────────────────────
-- Igual que 20260925170542, con el filtro de habilitado sumado.
create or replace function public.ficha_cliente(p_cliente_id uuid)
returns table(razon_social text, nombre_fantasia text, direccion_id uuid, direccion_formateada text)
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select c.razon_social, c.nombre_fantasia, d.id, d.direccion_formateada
    from public.clientes c
    left join lateral (
      select id, direccion_formateada
        from public.direcciones
       where cliente_id = c.id
       order by principal desc, creado_en
       limit 1
    ) d on true
   where c.id = p_cliente_id
     and interno.esta_habilitado()
     and (c.habilitado or (select interno.puede_ver_todo()));
$function$;

-- ── confirmar_cliente_provisorio ─────────────────────────────────────────────
-- Igual que 20261007192602, pero al confirmar deja el cliente HABILITADO: un
-- cliente que el vendedor cargó y la oficina aprobó tiene que poder usarse ya
-- aunque todavía no figure en el listado del Gestión.
create or replace function public.confirmar_cliente_provisorio(p_cliente_id uuid, p_codigo text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cod text := upper(btrim(coalesce(p_codigo, '')));
begin
  if not interno.es_administracion() then
    raise exception 'Sólo administración o un administrador puede confirmar clientes.' using errcode = '42501';
  end if;
  if v_cod = '' then
    raise exception 'Escribí el código de cliente definitivo.' using errcode = '23514';
  end if;
  if v_cod like 'P-%' then
    raise exception 'Ese es el código provisorio. Poné el código definitivo (sin "P-").' using errcode = '23514';
  end if;

  update public.clientes
     set codigo = v_cod, provisorio = false, habilitado = true
   where id = p_cliente_id and provisorio = true;

  if not found then
    raise exception 'Ese cliente no existe o ya estaba confirmado.' using errcode = 'P0002';
  end if;
exception
  when unique_violation then
    raise exception 'Ya existe un cliente con ese código.' using errcode = '23505';
end;
$function$;

-- ── set_cliente_habilitado (toggle del panel) ────────────────────────────────
-- Ajuste a mano desde el panel para casos puntuales (habilitar un cliente nuevo
-- antes del próximo listado, o deshabilitar uno). Sólo administración/admin.
create or replace function public.set_cliente_habilitado(p_cliente_id uuid, p_habilitado boolean)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not interno.es_administracion() then
    raise exception 'Sólo administración o un administrador puede cambiar el habilitado.' using errcode = '42501';
  end if;

  update public.clientes
     set habilitado = coalesce(p_habilitado, false), actualizado_en = now()
   where id = p_cliente_id;

  if not found then
    raise exception 'Ese cliente no existe.' using errcode = 'P0002';
  end if;
end;
$function$;

revoke execute on function public.set_cliente_habilitado(uuid, boolean) from public, anon;
grant execute on function public.set_cliente_habilitado(uuid, boolean) to authenticated;
