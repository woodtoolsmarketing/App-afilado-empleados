-- =============================================================================
-- Reflejar en el ROL DE VISITA que un cliente "cobró" cuando el cobro se carga
-- desde la pantalla COBRANZAS (no desde el parte).
--
-- La tabla `cobranzas` es independiente del booleano `visitas.cobro` por diseño
-- (ver 20260824124105). Pero el vendedor pidió que, al agregar un cobro a un
-- cliente que YA visitó ese día, el rol muestre que cobró. Esta RPC hace ese
-- enganche: dado el cliente y la fecha, marca cobro=true en SU visita de ese día.
--
-- SECURITY DEFINER acotada a auth.uid() (sólo toca las visitas propias del que
-- llama); aditiva (nunca baja el flag). RESPETA la misma ventana de 18h que
-- `visitas_corregir_mismo_dia`: no reescribe el 'cobró' de un rol ya cerrado/
-- impreso (el parte es historia, no borrador; y la X se imprime y se cuenta en
-- el tablero). Fuera de esa ventana —o si el cliente no tiene una visita
-- visitada ese día— no hace nada y devuelve false (el cobro igual quedó guardado
-- en `cobranzas`, que tiene su propio congelamiento con `impreso_en`).
-- =============================================================================
create or replace function public.marcar_cobro_de_visita(
  p_cliente_id uuid,
  p_fecha      date
)
 returns boolean
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare
  v_visita_id uuid;
begin
  if not interno.esta_habilitado() then
    raise exception 'Usuario no habilitado.' using errcode = '42501';
  end if;
  if p_cliente_id is null or p_fecha is null then
    return false;
  end if;

  -- La visita de ese cliente en el rol de ese día del vendedor que llama. Sólo
  -- las visitadas y dentro de la ventana de 18h (igual que corregir el parte): si
  -- el cliente entró por varias sucursales, la primera por orden de parada
  -- (alcanza con una para decir que el cliente cobró).
  select v.id
    into v_visita_id
    from public.visitas v
    join public.paradas pa      on pa.id = v.parada_id
    join public.roles_visita rv on rv.id = v.rol_visita_id
   where rv.vendedor_id = auth.uid()
     and rv.fecha = p_fecha
     and v.cliente_id = p_cliente_id
     and v.visitado = true
     and v.registrado_en > now() - interval '18 hours'
   order by pa.orden asc
   limit 1;

  if v_visita_id is null then
    return false;
  end if;

  -- `visitado = true` también en el update: idempotente y a prueba de que la
  -- visita se haya re-registrado como "no visitada" entre el select y el update
  -- (poner cobro sobre una no-visitada violaría el CHECK del parte).
  update public.visitas
     set cobro = true, actualizado_en = now()
   where id = v_visita_id
     and visitado = true
     and cobro = false;

  return true;
end;
$$;

revoke all on function public.marcar_cobro_de_visita(uuid, date) from public;
revoke all on function public.marcar_cobro_de_visita(uuid, date) from anon;
grant execute on function public.marcar_cobro_de_visita(uuid, date) to authenticated;
