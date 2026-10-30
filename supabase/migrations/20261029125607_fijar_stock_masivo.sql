-- =============================================================================
-- WoodTools · carga masiva de stock desde el Excel del Gestion
--
-- fijar_stock_masivo(items jsonb, cero_faltantes bool, dry_run bool) -> jsonb
--   items = [{"codigo":"X","cantidad":N}, ...] (ya deduplicado por el cliente).
--
-- Clasifica cada codigo contra el catalogo:
--   - producto vendible (es_servicio=false) -> se carga el stock.
--   - servicio (es_servicio=true) o inexistente -> se ignora y se reporta.
-- dry_run=true devuelve la PREVIA (clasificacion + conteos) SIN escribir.
-- cero_faltantes=true pone en 0 los productos vendibles que NO vinieron en el
-- Excel (para cuando el archivo es la foto completa del deposito); solo pisa los
-- que hoy tienen un stock <> 0 (no crea filas en 0 por gusto).
--
-- SECURITY DEFINER con guardia es_administracion(), igual que fijar_stock.
-- =============================================================================

create or replace function public.fijar_stock_masivo(
  p_items jsonb,
  p_cero_faltantes boolean default false,
  p_dry_run boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prod int; v_serv int; v_nocat int; v_cero int;
  v_faltan jsonb;
begin
  if not interno.es_administracion() then
    raise exception 'Solo el Dpto. de Administracion puede cargar stock' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Los items tienen que ser un arreglo JSON' using errcode = '22023';
  end if;

  drop table if exists _items;
  drop table if exists _clasif;

  -- Normaliza y deduplica (por si el cliente mando repetidos): codigo -> cantidad.
  create temporary table _items on commit drop as
    select codigo, max(cantidad) as cantidad
    from (
      select btrim(e->>'codigo') as codigo,
             greatest(round(coalesce(nullif(e->>'cantidad', ''), '0')::numeric)::int, 0) as cantidad
      from jsonb_array_elements(p_items) e
      where coalesce(btrim(e->>'codigo'), '') <> ''
    ) q
    group by codigo;

  -- Clasifica cada codigo del Excel contra el catalogo.
  create temporary table _clasif on commit drop as
    select i.codigo, i.cantidad,
      case when c.codigo is null then 'no_catalogo'
           when c.es_servicio then 'servicio'
           else 'producto' end as clase
    from _items i
    left join (
      select codigo, bool_or(es_servicio) as es_servicio
      from public.catalogo_articulos group by codigo
    ) c on c.codigo = i.codigo;

  select count(*) filter (where clase = 'producto'),
         count(*) filter (where clase = 'servicio'),
         count(*) filter (where clase = 'no_catalogo')
    into v_prod, v_serv, v_nocat
    from _clasif;

  -- Lista (acotada) de los que estan en el Excel pero NO en el catalogo: lo
  -- accionable para la oficina (un codigo del Gestion que todavia no se cargo al
  -- catalogo de precios no puede llevar stock hasta que se agregue).
  select coalesce(jsonb_agg(codigo order by codigo), '[]'::jsonb) into v_faltan
    from (select codigo from _clasif where clase = 'no_catalogo' order by codigo limit 100) t;

  -- Cuantos productos vendibles con stock <> 0 quedarian/quedaron en 0 por no
  -- venir en el Excel (misma condicion que el UPDATE de abajo).
  select count(*) into v_cero
    from public.stock_articulos s
    where p_cero_faltantes
      and s.cantidad <> 0
      and exists (select 1 from public.vista_catalogo_vigente v where v.codigo = s.codigo and v.es_servicio = false)
      and not exists (select 1 from _items i where i.codigo = s.codigo);

  if not p_dry_run then
    insert into public.stock_articulos (codigo, cantidad, actualizado_en, actualizado_por)
      select codigo, cantidad, now(), auth.uid() from _clasif where clase = 'producto'
      on conflict (codigo) do update
        set cantidad = excluded.cantidad, actualizado_en = now(), actualizado_por = auth.uid();

    if p_cero_faltantes then
      update public.stock_articulos s
        set cantidad = 0, actualizado_en = now(), actualizado_por = auth.uid()
      where s.cantidad <> 0
        and exists (select 1 from public.vista_catalogo_vigente v where v.codigo = s.codigo and v.es_servicio = false)
        and not exists (select 1 from _items i where i.codigo = s.codigo);
    end if;

    insert into public.auditoria (actor_id, accion, entidad, entidad_id, datos)
    values (auth.uid(), 'stock.carga_masiva', 'stock_articulos', null,
            jsonb_build_object('productos', v_prod, 'servicios', v_serv, 'no_catalogo', v_nocat,
                               'puestos_en_cero', v_cero, 'cero_faltantes', p_cero_faltantes));
  end if;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'cero_faltantes', p_cero_faltantes,
    'recibidos', (select count(*) from _items),
    'productos', v_prod,
    'servicios', v_serv,
    'no_catalogo', v_nocat,
    'puestos_en_cero', v_cero,
    'faltan_en_catalogo', v_faltan
  );
end;
$$;

revoke all on function public.fijar_stock_masivo(jsonb, boolean, boolean) from public, anon;
grant execute on function public.fijar_stock_masivo(jsonb, boolean, boolean) to authenticated;
