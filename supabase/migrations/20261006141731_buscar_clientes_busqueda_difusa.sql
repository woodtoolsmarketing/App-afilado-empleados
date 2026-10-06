-- Buscar clientes por nombre/razón social: ahora tolera errores de tipeo y
-- variantes (trigramas). Antes, cualquier letra de más o de menos dejaba al
-- cliente invisible ("no ubica a los clientes por ahí"): el motor sólo hacía
-- substring exacto de CADA palabra.
--
-- Índice GIN de trigramas sobre busqueda_plana: acelera tanto el LIKE '%...%'
-- (camino exacto) como el nuevo operador %> (camino difuso). Sin él, los dos
-- hacían seq scan de 16k clientes (medido: 390 ms); con él, ~4 ms.
create index if not exists clientes_busqueda_trgm
  on public.clientes using gin (busqueda_plana extensions.gin_trgm_ops) where activo;

-- Forzar la carga de pg_trgm en esta sesión: su librería registra el GUC
-- pg_trgm.word_similarity_threshold recién al primer uso, y sin el GUC
-- registrado, fijarlo en la config de la función (abajo) pide superusuario.
do $$ begin perform extensions.word_similarity('a', 'a'); end $$;

create or replace function public.buscar_clientes(p_texto text, p_limite integer default 15)
 returns table(cliente_id uuid, codigo text, razon_social text, nombre_fantasia text, cuit text, contacto_nombre text, telefono text, email text, provisorio boolean, vendedor_id uuid, direccion_id uuid, direccion text, codigo_postal text, lat double precision, lng double precision, localidad text, provincia text)
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set pg_trgm.word_similarity_threshold to '0.4'
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
