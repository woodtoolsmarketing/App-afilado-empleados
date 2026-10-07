-- ─────────────────────────────────────────────────────────────────────────────
-- Un administrador puede MODIFICAR cualquier nota, incluso impresa
--
-- `actualizar_nota_pedido` corta por `impresa_en`: una vez que la nota salió en
-- papel no se toca, tenga el estado que tenga. Esa es la regla para el VENDEDOR,
-- y está bien: lo que la fábrica tiene en la mano no se cambia por atrás sin que
-- nadie lo sepa.
--
-- Pero Administración sí tiene que poder corregir una nota ya impresa (un
-- precio mal cargado, una medida equivocada que se descubre después): el editor
-- del panel avisa que la copia en papel queda distinta y que hay que
-- reimprimirla. Esta función es esa puerta, y SÓLO para admin —igual que anular—.
--
-- Diferencias con `actualizar_nota_pedido`:
--   · SECURITY DEFINER: corre con los permisos del dueño, así escribe aunque la
--     RLS de `notas_pedido` no deje editar una nota impresa.
--   · admin-only (`interno.es_admin()`), que corta antes de tocar nada.
--   · SIN las guardas de `impresa_en` ni de `estado`: acepta cualquier estado.
--   · NO toca `numero`, `estado`, `vendedor_id`, `creado_en` ni `impresa_en`:
--     sólo reemplaza el contenido. El ciclo de vida de la nota no se mueve.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.modificar_nota_pedido(
  p_nota_id uuid,
  p_nota    jsonb,
  p_items   jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  estado_actual public.estado_nota_pedido;
  filas         integer;
  it            jsonb;
  renglon       public.notas_pedido_items;
  j             integer := 0;
begin
  -- Sólo un administrador, igual que anular. Más adelante se abrirá; por ahora
  -- esto es la única diferencia que permite pasar por encima del papel.
  if not interno.es_admin() then
    raise exception 'Sólo un administrador puede modificar notas.' using errcode = '42501';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'La nota no puede quedar sin renglones' using errcode = '22023';
  end if;

  select n.estado
    into estado_actual
    from public.notas_pedido n
   where n.id = p_nota_id;

  if estado_actual is null then
    raise exception 'Esa nota no existe' using errcode = 'P0002';
  end if;

  -- SIN guardas de `impresa_en` ni de `estado`: un admin corrige la nota en
  -- cualquier estado. No se toca `estado` ni `impresa_en` —el editor avisa que
  -- la copia en papel queda distinta y que se puede reimprimir desde la cola—.
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
    actualizado_en                 = now()
  where n.id = p_nota_id;

  get diagnostics filas = row_count;
  if filas = 0 then
    raise exception 'No pudimos guardar los cambios de esa nota.' using errcode = '42501';
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

comment on function public.modificar_nota_pedido(uuid, jsonb, jsonb) is
  'Reemplaza el contenido de CUALQUIER nota (incluso impresa). Admin-only (SECURITY DEFINER); no toca numero/estado/impresa_en/vendedor_id/creado_en. El editor del panel avisa que la copia en papel queda distinta.';

-- create/create or replace resetea el ACL a PUBLIC, así que los revoke van sí o
-- sí: sin ellos, cualquier rol (anon incluido) podría ejecutar una función que
-- escribe con permisos de dueño. El gate real es `interno.es_admin()` adentro,
-- pero la superficie se cierra igual.
revoke all on function public.modificar_nota_pedido(uuid, jsonb, jsonb) from public;
revoke all on function public.modificar_nota_pedido(uuid, jsonb, jsonb) from anon;
grant execute on function public.modificar_nota_pedido(uuid, jsonb, jsonb) to authenticated;
