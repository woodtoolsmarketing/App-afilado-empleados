-- =============================================================================
-- La situación de IVA del cliente en la nota de pedido
--
-- Hasta acá la nota guardaba un total y nada más. Con eso alcanza para un
-- presupuesto, pero una FACTURA tiene que decir frente a quién se emite, porque
-- de eso depende el importe que se cobra:
--
--   · consumidor_final      → el IVA va sumado adentro del total
--   · exento                → sin IVA, y sólo si el domicilio del cliente está
--                             en Tierra del Fuego. Fuera de la provincia un
--                             "exento" se factura igual que un consumidor
--                             final: la exención es del territorio, no del
--                             cliente.
--   · responsable_inscripto → el total va neto y el comprobante lo aclara con
--                             un "+ IVA" al lado
--
-- Lo que se guarda en `total` sigue siendo el NETO. El IVA no se persiste: se
-- deriva de esta columna cuando hace falta mostrarlo o imprimirlo. Guardar los
-- dos abriría la puerta a que dejaran de coincidir, y el que manda es el neto,
-- que es el que suman los renglones.
--
-- Queda NULL en los presupuestos y en todas las notas anteriores a este cambio:
-- ninguna de las dos cosas discrimina IVA.
-- =============================================================================

alter table public.notas_pedido
  add column if not exists situacion_iva text;

comment on column public.notas_pedido.situacion_iva is
  'Frente a quien se emite la factura: consumidor_final, exento o responsable_inscripto. NULL en los presupuestos y en las notas anteriores a la columna.';

alter table public.notas_pedido
  drop constraint if exists notas_pedido_situacion_iva_valida;

alter table public.notas_pedido
  add constraint notas_pedido_situacion_iva_valida
  check (
    situacion_iva is null
    or situacion_iva in ('consumidor_final', 'exento', 'responsable_inscripto')
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- `actualizar_nota_pedido` lista las columnas a mano
--
-- El alta usa `jsonb_populate_record`, que toma la columna nueva sola en cuanto
-- existe. La corrección no: enumera cada columna en el UPDATE, así que sin esta
-- línea corregir una nota le borraría la situación de IVA sin decir nada — y la
-- nota volvería a salir con el total equivocado.
--
-- Es la misma función de la migración anterior con `situacion_iva` sumada; se
-- reescribe entera porque `create or replace` no admite parches.
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
$$;

comment on function public.actualizar_nota_pedido(uuid, jsonb, jsonb) is
  'Reemplaza el contenido de una nota que todavia no salio en papel. Corta por impresa_en, no por estado: las notas que esperan codigo de cliente se imprimen sin cambiar de estado.';

revoke all on function public.actualizar_nota_pedido(uuid, jsonb, jsonb) from public;
grant execute on function public.actualizar_nota_pedido(uuid, jsonb, jsonb) to authenticated;
