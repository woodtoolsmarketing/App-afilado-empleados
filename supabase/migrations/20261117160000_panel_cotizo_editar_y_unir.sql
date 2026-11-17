-- =============================================================================
-- El panel aprende el tipo de visita nuevo "cotizó" (ver 20261117140000).
--
-- Dos funciones admin del panel quedaron sin enterarse de `visitas.cotizo`:
--
--   editar_parte_visita     No podía editar un parte que es SÓLO cotizó: su
--                           guard exigía uno de los seis tipos viejos, y su
--                           UPDATE nunca tocaba cotizo (lo habría borrado).
--   unir_paradas_duplicadas Al unir dos paradas, el OR-merge no incluía cotizo,
--                           así que perdía el cotizó de la visita absorbida.
--
-- editar_parte_visita suma un parámetro (DROP+CREATE). Es BACKWARD-SAFE: p_cotizo
-- default null + coalesce(p_cotizo, v.cotizo), así el panel VIEJO (1.3.2, que no
-- manda p_cotizo) NO pisa el cotizó que ya tenía la visita. El panel nuevo lo
-- manda explícito.
-- =============================================================================

-- ── Editar el parte: ahora conoce "cotizó" ──
drop function if exists public.editar_parte_visita(
  uuid, boolean, boolean, boolean, boolean, boolean, boolean, text, text, text
);

create function public.editar_parte_visita(
  p_visita_id      uuid,
  p_vendio         boolean,
  p_cobro          boolean,
  p_retiro_afilado boolean,
  p_entrego        boolean,
  p_sin_pedido     boolean,
  p_otras          boolean,
  p_otras_detalle  text,
  p_observacion    text,
  p_contacto       text,
  p_cotizo         boolean default null
)
 returns void
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare
  v public.visitas;
  v_obs text := btrim(coalesce(p_observacion, ''));
  v_otras_detalle text := nullif(btrim(coalesce(p_otras_detalle, '')), '');
  v_cotizo boolean;
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

  -- El panel viejo (1.3.2) no manda p_cotizo: se conserva lo que la visita ya
  -- tenía, para no borrar un cotizó sin querer. El panel nuevo lo manda explícito.
  v_cotizo := coalesce(p_cotizo, v.cotizo);

  if not (p_vendio or p_cobro or p_retiro_afilado or p_entrego or p_sin_pedido or p_otras or v_cotizo) then
    raise exception 'Marcá al menos una acción (vendió, cobró, retiró, entregó, sin pedido, otras o cotizó).' using errcode = '23514';
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
         cotizo = v_cotizo,
         otras_detalle = case when p_otras then v_otras_detalle else null end,
         observacion = v_obs,
         observacion_origen = 'texto',
         contacto_nombre = nullif(btrim(coalesce(p_contacto, '')), ''),
         actualizado_en = now()
   where id = p_visita_id;
end;
$$;

revoke all on function public.editar_parte_visita(uuid, boolean, boolean, boolean, boolean, boolean, boolean, text, text, text, boolean) from public;
revoke all on function public.editar_parte_visita(uuid, boolean, boolean, boolean, boolean, boolean, boolean, text, text, text, boolean) from anon;
grant execute on function public.editar_parte_visita(uuid, boolean, boolean, boolean, boolean, boolean, boolean, text, text, text, boolean) to authenticated;


-- ── Unir paradas duplicadas: el OR-merge ahora incluye cotizó ──
-- Mismo cuerpo que 20261019141133 + `cotizo = s.cotizo or bv.cotizo`. Firma sin
-- cambios → CREATE OR REPLACE conserva los grants.
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
    update public.notas_pedido set parada_id = v_sobrevive where parada_id = b.parada_id;

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
               cotizo = s.cotizo or bv.cotizo,
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
        update public.visitas set parada_id = v_sobrevive, actualizado_en = now()
         where parada_id = b.parada_id;
        v_sobrevive_visita := bv.id;
      end if;
    end if;

    update public.paradas s
       set llegada_en = least(s.llegada_en, b.llegada_en),
           salida_en  = greatest(s.salida_en, b.salida_en),
           actualizado_en = now()
     where s.id = v_sobrevive;

    delete from public.paradas where id = b.parada_id;
    v_unidas := v_unidas + 1;
  end loop;

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
