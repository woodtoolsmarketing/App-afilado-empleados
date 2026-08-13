-- ─────────────────────────────────────────────────────────────────────────────
-- La regla de la impresión también vale para Administración
--
-- `actualizar_nota_pedido` confiaba enteramente en las políticas de la tabla, y
-- ahí hay dos: la del vendedor —que exige estado pendiente— y la de
-- Administración, que es ALL sin condición de estado. Las políticas se suman,
-- así que un usuario con rol `admin` o `administracion` podía reemplazar por
-- esta vía una nota que la fábrica ya tenía impresa en la mano, y quedaban dos
-- versiones del mismo comprobante sin nada que lo delatara.
--
-- Salió probándolo: la corrección de una nota `impresa` entró sin chistar
-- porque la cuenta con la que se probó es `admin`.
--
-- El corte es del comprobante, no del permiso: una vez impresa no se corrige
-- por acá. Para eso está anular y volver a cargar, que deja rastro.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.actualizar_nota_pedido(
  p_nota_id uuid,
  p_nota    jsonb,
  p_items   jsonb
)
returns void
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $$
declare
  estado_actual public.estado_nota_pedido;
  filas   integer;
  it      jsonb;
  renglon public.notas_pedido_items;
  j       integer := 0;
begin
  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'La nota no puede quedar sin renglones' using errcode = '22023';
  end if;

  -- Se lee primero para poder decir POR QUÉ no se puede. Sin esto, el UPDATE
  -- de abajo simplemente tocaba cero filas y el mensaje tenía que adivinar
  -- entre "no es tuya" y "ya se imprimió".
  select n.estado into estado_actual
    from public.notas_pedido n
   where n.id = p_nota_id;

  if estado_actual is null then
    raise exception 'Esa nota no existe o no la podés ver' using errcode = '42501';
  end if;

  if estado_actual not in ('pendiente', 'pendiente_cliente') then
    raise exception 'La nota ya se imprimio: no se puede corregir. Anulala y carga una nueva.'
      using errcode = '42501';
  end if;

  update public.notas_pedido n set
    cliente_id                     = nullif(p_nota ->> 'cliente_id', '')::uuid,
    cliente_codigo                 = nullif(p_nota ->> 'cliente_codigo', ''),
    cliente_nombre                 = coalesce(nullif(p_nota ->> 'cliente_nombre', ''), n.cliente_nombre),
    cliente_cuit                   = nullif(p_nota ->> 'cliente_cuit', ''),
    zona                           = nullif(p_nota ->> 'zona', ''),
    datos_cliente                  = nullif(p_nota ->> 'datos_cliente', ''),
    datos_cliente_origen           = coalesce(
                                       nullif(p_nota ->> 'datos_cliente_origen', '')::origen_observacion,
                                       n.datos_cliente_origen),
    descripcion_herramienta        = nullif(p_nota ->> 'descripcion_herramienta', ''),
    descripcion_herramienta_origen = coalesce(
                                       nullif(p_nota ->> 'descripcion_herramienta_origen', '')::origen_observacion,
                                       n.descripcion_herramienta_origen),
    vendedor_numero                = nullif(p_nota ->> 'vendedor_numero', ''),
    servicios                      = coalesce(
                                       (select array_agg(x::tipo_servicio)
                                          from jsonb_array_elements_text(p_nota -> 'servicios') x),
                                       n.servicios),
    tipo_nota                      = nullif(p_nota ->> 'tipo_nota', '')::tipo_nota_pedido,
    fecha_entrega                  = nullif(p_nota ->> 'fecha_entrega', '')::date,
    tipo_cambio                    = nullif(p_nota ->> 'tipo_cambio', '')::numeric,
    cotizacion_fecha               = nullif(p_nota ->> 'cotizacion_fecha', '')::date,
    total                          = nullif(p_nota ->> 'total', '')::numeric,
    -- Sin observaciones queda el arreglo vacío, no el de antes: borrarlas
    -- todas es una corrección válida.
    observaciones                  = coalesce(
                                       (select array_agg(x)
                                          from jsonb_array_elements_text(p_nota -> 'observaciones') x),
                                       '{}'::text[]),
    condicion_venta                = nullif(p_nota ->> 'condicion_venta', '')::condicion_venta,
    condicion_venta_detalle        = nullif(p_nota ->> 'condicion_venta_detalle', ''),
    actualizado_en                 = now()
  where n.id = p_nota_id;

  get diagnostics filas = row_count;
  if filas = 0 then
    raise exception 'Esa nota no es tuya' using errcode = '42501';
  end if;

  -- Los renglones se reemplazan enteros. Aparearlos uno a uno con los que había
  -- sería adivinar: el vendedor puede haber sacado el segundo y agregado dos.
  delete from public.notas_pedido_items where nota_id = p_nota_id;

  for it in select value from jsonb_array_elements(p_items)
  loop
    j := j + 1;
    renglon := jsonb_populate_record(null::public.notas_pedido_items, it);
    renglon.id              := extensions.gen_random_uuid();
    renglon.nota_id         := p_nota_id;
    renglon.orden           := coalesce(renglon.orden, j);
    renglon.cantidad        := coalesce(renglon.cantidad, 1);
    renglon.moneda          := coalesce(renglon.moneda, 'ARS');
    renglon.codigos_computo := coalesce(renglon.codigos_computo, '{}');
    renglon.promocion       := coalesce(renglon.promocion, false);
    renglon.dientes_rotos   := coalesce(renglon.dientes_rotos, false);
    renglon.detalle         := coalesce(renglon.detalle, '{}'::jsonb);
    renglon.creado_en       := clock_timestamp();
    insert into public.notas_pedido_items select (renglon).*;
  end loop;
end;
$$;

comment on function public.actualizar_nota_pedido(uuid, jsonb, jsonb) is
  'Reemplaza el encabezado y los renglones de una nota que todavia no se imprimio. Ni siquiera Administracion puede tocar una impresa por aca. No cambia numero, estado ni vendedor.';

revoke all on function public.actualizar_nota_pedido(uuid, jsonb, jsonb) from public;
grant execute on function public.actualizar_nota_pedido(uuid, jsonb, jsonb) to authenticated;
