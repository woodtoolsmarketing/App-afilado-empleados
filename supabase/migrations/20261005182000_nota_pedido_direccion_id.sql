-- La nota de pedido guarda a qué dirección/sucursal del cliente apunta.
--
-- Hasta ahora la nota tenía los datos del cliente sólo como texto
-- (`datos_cliente`). Desde que un cliente puede tener varias direcciones
-- (principal + lugares de entrega, cargadas desde el panel), la nota guarda CUÁL
-- se eligió, para poder después reportar o filtrar por sucursal. El texto de
-- `datos_cliente` se arma igual con esa dirección; esto es el dato estructurado.
--
-- `on delete set null`: si se borra la dirección, la nota NO se cae —queda el
-- texto con lo que decía—; sólo pierde el vínculo estructurado.

alter table public.notas_pedido
  add column if not exists direccion_id uuid references public.direcciones(id) on delete set null;

comment on column public.notas_pedido.direccion_id is
  'A qué direccion/sucursal del cliente apunta el pedido. El create la toma sola (jsonb_populate_record); el update la setea en actualizar_nota_pedido.';

-- El create (crear_notas_pedido) usa jsonb_populate_record, así que toma
-- direccion_id solo con que venga en el JSON. El UPDATE de la corrección, en
-- cambio, lleva lista EXPLÍCITA de columnas: hay que sumarle direccion_id.
create or replace function public.actualizar_nota_pedido(p_nota_id uuid, p_nota jsonb, p_items jsonb)
 returns void
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
  estado_actual  public.estado_nota_pedido;
  impresa_actual timestamptz;
  filas          integer;
  it             jsonb;
  renglon        public.notas_pedido_items;
  j              integer := 0;
begin
  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'La nota no puede quedar sin renglones' using errcode = '22023';
  end if;

  select n.estado, n.impresa_en
    into estado_actual, impresa_actual
    from public.notas_pedido n
   where n.id = p_nota_id;

  if estado_actual is null then
    raise exception 'Esa nota no existe o no la podés ver' using errcode = '42501';
  end if;

  -- El papel manda: si ya salió, no se toca, tenga el estado que tenga.
  if impresa_actual is not null then
    raise exception 'La nota ya se imprimio: no se puede corregir. Anulala y carga una nueva.'
      using errcode = '42501';
  end if;

  if estado_actual not in ('pendiente', 'pendiente_cliente') then
    raise exception 'La nota ya no se puede corregir: esta %.', estado_actual
      using errcode = '42501';
  end if;

  update public.notas_pedido n set
    cliente_id                     = nullif(p_nota ->> 'cliente_id', '')::uuid,
    cliente_codigo                 = nullif(p_nota ->> 'cliente_codigo', ''),
    cliente_nombre                 = coalesce(nullif(p_nota ->> 'cliente_nombre', ''), n.cliente_nombre),
    cliente_cuit                   = nullif(p_nota ->> 'cliente_cuit', ''),
    direccion_id                   = nullif(p_nota ->> 'direccion_id', '')::uuid,
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
    observaciones                  = coalesce(
                                       (select array_agg(x)
                                          from jsonb_array_elements_text(p_nota -> 'observaciones') x),
                                       '{}'),
    condicion_venta                = nullif(p_nota ->> 'condicion_venta', '')::condicion_venta,
    condicion_venta_detalle        = nullif(p_nota ->> 'condicion_venta_detalle', ''),
    situacion_iva                  = nullif(p_nota ->> 'situacion_iva', ''),
    actualizado_en                 = now()
  where n.id = p_nota_id;

  get diagnostics filas = row_count;
  if filas = 0 then
    raise exception 'No pudimos guardar la corrección: esa nota no es tuya o ya no se puede editar.'
      using errcode = '42501';
  end if;

  delete from public.notas_pedido_items where nota_id = p_nota_id;

  for it in select value from jsonb_array_elements(p_items)
  loop
    j := j + 1;
    renglon                 := jsonb_populate_record(null::public.notas_pedido_items, it);
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
$function$;
