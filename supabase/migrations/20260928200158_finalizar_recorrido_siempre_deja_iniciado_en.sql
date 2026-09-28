-- Causa de fondo de las jornadas 'finalizado' sin iniciado_en: finalizar_recorrido
-- finaliza CUALQUIER jornada sin guard, asi que una 'planificado' (nunca iniciada,
-- iniciado_en null) al finalizarse quedaba 'finalizado' con iniciado_en null. Eso es
-- lo que despues rompia el reopen de agregar_parada. Ahora finalizar tambien deja
-- iniciado_en = coalesce(iniciado_en, now()): una jornada finalizada siempre tuvo un
-- inicio (aunque sea el instante en que se cerro).
create or replace function public.finalizar_recorrido(p_rol_visita_id uuid)
 returns roles_visita
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
  jornada public.roles_visita;
begin
  update public.paradas
     set estado = 'omitida'
   where rol_visita_id = p_rol_visita_id
     and estado in ('pendiente', 'en_camino');

  update public.roles_visita
     set estado        = 'finalizado',
         finalizado_en = now(),
         iniciado_en   = coalesce(iniciado_en, now())
   where id = p_rol_visita_id
  returning * into jornada;

  update public.posiciones_actuales
     set en_recorrido = false, actualizado_en = now()
   where rol_visita_id = p_rol_visita_id;

  return jornada;
end;
$function$;

-- Corregir las jornadas ya finalizadas sin inicio: se les pone el instante de cierre.
update public.roles_visita
   set iniciado_en = finalizado_en
 where estado = 'finalizado'
   and iniciado_en is null
   and finalizado_en is not null;
