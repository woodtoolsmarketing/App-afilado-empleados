-- =============================================================================
-- El admin edita el ROL DE VISITA desde el panel:
--   · editar_parte_visita: corregir las acciones del parte (vendió/cobró/…), la
--     observación y el contacto de una visita ya hecha.
--   · unir_paradas_duplicadas: cuando el vendedor cargó el mismo cliente+sucursal
--     dos veces, unir las paradas en una, combinando todo lo que hizo en ambas.
--
-- Las dos son SECURITY DEFINER + gate interno.es_admin(): el admin toca paradas/
-- visitas de OTRO vendedor (la RLS *_admin ya lo permite), y la RPC centraliza
-- las guardas de los CHECK en un solo lugar, igual que cambiar_rol_usuario.
-- =============================================================================

-- ── Editar el parte de una visita hecha ──
create or replace function public.editar_parte_visita(
  p_visita_id      uuid,
  p_vendio         boolean,
  p_cobro          boolean,
  p_retiro_afilado boolean,
  p_entrego        boolean,
  p_sin_pedido     boolean,
  p_otras          boolean,
  p_otras_detalle  text,
  p_observacion    text,
  p_contacto       text
)
 returns void
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare
  v public.visitas;
  v_obs text := btrim(coalesce(p_observacion, ''));
  v_otras_detalle text := nullif(btrim(coalesce(p_otras_detalle, '')), '');
begin
  if not interno.es_admin() then
    raise exception 'Sólo un administrador puede editar el parte.' using errcode = '42501';
  end if;

  select * into v from public.visitas where id = p_visita_id;
  if v.id is null then
    raise exception 'No existe ese parte de visita.' using errcode = 'P0002';
  end if;
  if not v.visitado then
    raise exception 'Sólo se edita el parte de una visita que se hizo.' using errcode = '23514';
  end if;
  if not (p_vendio or p_cobro or p_retiro_afilado or p_entrego or p_sin_pedido or p_otras) then
    raise exception 'Marcá al menos una acción (vendió, cobró, retiró, entregó, sin pedido u otras).' using errcode = '23514';
  end if;
  if p_otras and v_otras_detalle is null then
    raise exception 'Si marcás "Otras", contá qué pasó.' using errcode = '23514';
  end if;
  if not interno.observacion_valida(v_obs) then
    raise exception 'La observación es muy corta: contá un poco más (al menos 3 palabras).' using errcode = '23514';
  end if;

  update public.visitas
     set vendio = p_vendio,
         cobro = p_cobro,
         retiro_afilado = p_retiro_afilado,
         entrego = p_entrego,
         sin_pedido = p_sin_pedido,
         otras = p_otras,
         otras_detalle = case when p_otras then v_otras_detalle else null end,
         observacion = v_obs,
         observacion_origen = 'texto',
         contacto_nombre = nullif(btrim(coalesce(p_contacto, '')), ''),
         actualizado_en = now()
   where id = p_visita_id;
end;
$$;

-- ── Unir las paradas duplicadas de un cliente+sucursal en una sola ──
create or replace function public.unir_paradas_duplicadas(
  p_rol_visita_id uuid,
  p_cliente_id    uuid,
  p_direccion_id  uuid
)
 returns integer
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare
  v_sobrevive        uuid;
  v_sobrevive_visita uuid;
  b                  record;
  bv                 public.visitas;
  v_unidas           integer := 0;
begin
  if not interno.es_admin() then
    raise exception 'Sólo un administrador puede unir paradas.' using errcode = '42501';
  end if;
  if p_cliente_id is null then
    raise exception 'No se puede unir sin cliente.' using errcode = '23514';
  end if;

  -- La parada que queda: primero la visitada (la más temprana), si no la de
  -- menor orden. Sólo mismo rol + cliente + dirección (otra dirección = otra
  -- sucursal, no se une).
  select pa.id, v.id
    into v_sobrevive, v_sobrevive_visita
    from public.paradas pa
    left join public.visitas v on v.parada_id = pa.id
   where pa.rol_visita_id = p_rol_visita_id
     and pa.cliente_id = p_cliente_id
     and pa.direccion_id is not distinct from p_direccion_id
   order by (v.visitado is true) desc, v.registrado_en asc nulls last, pa.orden asc
   limit 1;

  if v_sobrevive is null then
    return 0;
  end if;

  for b in
    select pa.id as parada_id, pa.llegada_en, pa.salida_en
      from public.paradas pa
     where pa.rol_visita_id = p_rol_visita_id
       and pa.cliente_id = p_cliente_id
       and pa.direccion_id is not distinct from p_direccion_id
       and pa.id <> v_sobrevive
  loop
    -- 1) Las notas de la parada que se va pasan a la que queda.
    update public.notas_pedido set parada_id = v_sobrevive where parada_id = b.parada_id;

    -- 2) Combinar la visita de b en la sobreviviente.
    select * into bv from public.visitas where parada_id = b.parada_id;
    if bv.id is not null then
      if v_sobrevive_visita is not null then
        update public.visitas s
           set visitado = s.visitado or bv.visitado,
               vendio = s.vendio or bv.vendio,
               cobro = s.cobro or bv.cobro,
               retiro_afilado = s.retiro_afilado or bv.retiro_afilado,
               entrego = s.entrego or bv.entrego,
               sin_pedido = s.sin_pedido or bv.sin_pedido,
               otras = s.otras or bv.otras,
               otras_detalle = case
                 when (s.otras or bv.otras)
                   then nullif(btrim(concat_ws(' · ',
                          nullif(btrim(coalesce(s.otras_detalle, '')), ''),
                          nullif(btrim(coalesce(bv.otras_detalle, '')), ''))), '')
                 else null end,
               observacion = case
                 when position(btrim(bv.observacion) in s.observacion) > 0 then s.observacion
                 else btrim(s.observacion || ' · ' || bv.observacion) end,
               contacto_nombre = coalesce(s.contacto_nombre, bv.contacto_nombre),
               motivo_no_visita = case
                 when (s.visitado or bv.visitado) then null
                 else coalesce(s.motivo_no_visita, bv.motivo_no_visita) end,
               -- Preservar la evidencia (audio + GPS del domicilio) de la que se
               -- borra, si la que queda no la tiene: es prueba de la visita.
               observacion_audio_url = coalesce(s.observacion_audio_url, bv.observacion_audio_url),
               observacion_origen = case
                 when s.observacion_audio_url is null and bv.observacion_audio_url is not null
                   then bv.observacion_origen
                 else s.observacion_origen end,
               lat = coalesce(s.lat, bv.lat),
               lng = coalesce(s.lng, bv.lng),
               precision_m = coalesce(s.precision_m, bv.precision_m),
               desvio_m = coalesce(s.desvio_m, bv.desvio_m),
               actualizado_en = now()
         where s.id = v_sobrevive_visita;
      else
        -- Defensivo e inalcanzable con el ORDER BY de arriba (la sobreviviente
        -- siempre tiene visita si alguna duplicada la tiene): si no la tuviera,
        -- se le re-apunta la de b (sin conflicto UNIQUE, porque S no tiene).
        update public.visitas set parada_id = v_sobrevive, actualizado_en = now()
         where parada_id = b.parada_id;
        v_sobrevive_visita := bv.id;
      end if;
    end if;

    -- 3) Hora combinada en la parada que queda (la más temprana de llegada).
    update public.paradas s
       set llegada_en = least(s.llegada_en, b.llegada_en),
           salida_en  = greatest(s.salida_en, b.salida_en),
           actualizado_en = now()
     where s.id = v_sobrevive;

    -- 4) Borrar la parada unida (su visita, si todavía apunta a ella, cae por CASCADE).
    delete from public.paradas where id = b.parada_id;
    v_unidas := v_unidas + 1;
  end loop;

  -- Si la visita que quedó está visitada, la parada que queda va 'visitada'.
  if v_sobrevive_visita is not null then
    update public.paradas s
       set estado = case
             when (select vv.visitado from public.visitas vv where vv.id = v_sobrevive_visita)
               then 'visitada'::public.estado_parada
             else s.estado end
     where s.id = v_sobrevive;
  end if;

  return v_unidas;
end;
$$;

revoke all on function public.editar_parte_visita(uuid, boolean, boolean, boolean, boolean, boolean, boolean, text, text, text) from public;
revoke all on function public.editar_parte_visita(uuid, boolean, boolean, boolean, boolean, boolean, boolean, text, text, text) from anon;
grant execute on function public.editar_parte_visita(uuid, boolean, boolean, boolean, boolean, boolean, boolean, text, text, text) to authenticated;
revoke all on function public.unir_paradas_duplicadas(uuid, uuid, uuid) from public;
revoke all on function public.unir_paradas_duplicadas(uuid, uuid, uuid) from anon;
grant execute on function public.unir_paradas_duplicadas(uuid, uuid, uuid) to authenticated;
