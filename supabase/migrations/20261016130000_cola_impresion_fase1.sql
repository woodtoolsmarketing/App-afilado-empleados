-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Cola de impresion por servidor — FASE 1 (base de datos)                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Generaliza `ordenes_impresion` (antes solo-nota) para que el vendedor encole
-- tambien el ROL de visita y las COBRANZAS, y para que la PC de la oficina las
-- imprima AUTOMATICO, en orden, mostrandole al vendedor su POSICION en la cola.
--
-- La nota sigue usando `nota_id` (+ el flag `con_rol_de_visita`, como hoy). El
-- rol y las cobranzas sueltos no tienen nota: guardan la fecha en `parametros` y
-- el vendedor es `pedida_por`.
--
-- (Aplicado al remoto por apply_migration en 3 pasos:
--  cola_impresion_generalizada, cola_impresion_posicion_desempate,
--  resolver_orden_impresion_definer. Este archivo es el estado final, para git.)

-- ── Esquema ───────────────────────────────────────────────────────────────────
alter table public.ordenes_impresion
  add column if not exists tipo text not null default 'nota',
  add column if not exists parametros jsonb not null default '{}'::jsonb;

alter table public.ordenes_impresion alter column nota_id drop not null;

alter table public.ordenes_impresion
  add constraint ordenes_impresion_tipo_valido check (tipo in ('nota', 'rol', 'cobranzas'));

-- Una nota tiene nota_id; un rol/cobranza no, pero trae la fecha.
alter table public.ordenes_impresion
  add constraint ordenes_impresion_tipo_coherente check (
    (tipo = 'nota' and nota_id is not null)
    or (tipo in ('rol', 'cobranzas') and nota_id is null and (parametros ? 'fecha'))
  );

-- Una sola orden viva por vendedor + tipo + fecha (rol/cobranzas). Las notas ya
-- tienen su indice unico por nota_id.
create unique index if not exists ordenes_impresion_una_por_fecha
  on public.ordenes_impresion (pedida_por, tipo, (parametros->>'fecha'))
  where estado in ('pendiente', 'imprimiendo') and tipo in ('rol', 'cobranzas');


-- ── Tomar la siguiente orden (la PC de la oficina, atomico) ───────────────────
-- Reclama la pendiente mas vieja. `for update skip locked` deja que dos PCs
-- trabajen a la vez sin pisarse. Rescata las que quedaron 'imprimiendo' hace mas
-- de 2 min (una PC que se cerro a mitad).
create or replace function public.tomar_siguiente_orden()
returns setof public.ordenes_impresion
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not interno.puede_ver_todo() then
    raise exception 'Solo la oficina toma ordenes de impresion' using errcode = '42501';
  end if;

  return query
  with siguiente as (
    select o.id
    from public.ordenes_impresion o
    where o.estado = 'pendiente'
       or (o.estado = 'imprimiendo' and o.tomada_en < now() - interval '2 minutes')
    order by o.creado_en
    for update skip locked
    limit 1
  )
  update public.ordenes_impresion o
     set estado = 'imprimiendo', tomada_en = now()
    from siguiente s
   where o.id = s.id
  returning o.*;
end;
$$;


-- ── Liberar una orden tomada (volver a la cola) ───────────────────────────────
-- Para el fallo TRANSITORIO (la impresora no contesto): vuelve a 'pendiente'
-- para reintentar, sin marcarla 'fallida'. El fallo DEFINITIVO usa resolver(false).
create or replace function public.liberar_orden_impresion(p_orden_id uuid, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not interno.puede_ver_todo() then
    raise exception 'Solo la oficina libera ordenes de impresion' using errcode = '42501';
  end if;

  update public.ordenes_impresion
     set estado = 'pendiente', tomada_en = null, motivo_fallo = p_motivo
   where id = p_orden_id and estado = 'imprimiendo';
end;
$$;


-- ── Cerrar la orden y sellar lo que corresponda, segun el tipo ────────────────
-- nota: sella la nota (misma regla que antes, incluida la 'pendiente_cliente'
-- que conserva el estado pero igual graba la fecha). cobranzas: sella los cobros
-- de ese vendedor y esa fecha. rol: nada (es una reimpresion).
-- SECURITY DEFINER para no depender de que la oficina tenga UPDATE por RLS sobre
-- cada tabla; el guard puede_ver_todo() limita quien resuelve.
create or replace function public.resolver_orden_impresion(
  p_orden_id uuid,
  p_ok boolean,
  p_motivo text default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_orden public.ordenes_impresion;
begin
  if not interno.puede_ver_todo() then
    raise exception 'Solo la oficina resuelve ordenes de impresion' using errcode = '42501';
  end if;

  update public.ordenes_impresion
     set estado       = case when p_ok then 'impresa' else 'fallida' end,
         motivo_fallo = case when p_ok then null else p_motivo end,
         resuelta_en  = now()
   where id = p_orden_id
     and estado in ('pendiente', 'imprimiendo')
  returning * into v_orden;

  if v_orden.id is null then
    raise exception 'La orden no existe o ya estaba resuelta';
  end if;

  if not p_ok then
    return;
  end if;

  if v_orden.tipo = 'nota' then
    update public.notas_pedido
       set estado = 'impresa', impresa_en = now()
     where id = v_orden.nota_id and estado = 'pendiente';

    update public.notas_pedido
       set impresa_en = now()
     where id = v_orden.nota_id and estado = 'pendiente_cliente';

  elsif v_orden.tipo = 'cobranzas' then
    update public.cobranzas
       set impreso_en = now()
     where vendedor_id = v_orden.pedida_por
       and fecha = (v_orden.parametros->>'fecha')::date
       and impreso_en is null;
  end if;
end;
$$;


-- ── Mi cola de impresion (el vendedor ve SU posicion) ─────────────────────────
-- Posicion en la cola global (1 = el proximo en salir), con desempate por id.
-- SECURITY DEFINER: para la posicion hay que contar los pendientes de TODOS, que
-- el vendedor no ve por RLS.
create or replace function public.mi_cola_de_impresion()
returns table (
  id uuid,
  tipo text,
  estado text,
  creado_en timestamptz,
  posicion int,
  total_en_cola int,
  descripcion text
)
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$
  with mias as (
    select o.*
    from public.ordenes_impresion o
    where o.pedida_por = auth.uid()
      and o.estado in ('pendiente', 'imprimiendo')
  )
  select
    m.id,
    m.tipo,
    m.estado,
    m.creado_en,
    (select count(*)::int from public.ordenes_impresion x
       where x.estado = 'pendiente'
         and (x.creado_en, x.id) <= (m.creado_en, m.id)) as posicion,
    (select count(*)::int from public.ordenes_impresion x
       where x.estado = 'pendiente') as total_en_cola,
    case m.tipo
      when 'rol' then 'Rol de visita del ' || to_char((m.parametros->>'fecha')::date, 'DD/MM')
      when 'cobranzas' then 'Cobranzas del ' || to_char((m.parametros->>'fecha')::date, 'DD/MM')
      else coalesce(
        (select 'Nota de ' || n.cliente_nombre from public.notas_pedido n where n.id = m.nota_id),
        'Nota de pedido'
      )
    end as descripcion
  from mias m
  order by m.creado_en, m.id;
$$;


revoke all on function public.tomar_siguiente_orden() from public, anon;
grant execute on function public.tomar_siguiente_orden() to authenticated;

revoke all on function public.liberar_orden_impresion(uuid, text) from public, anon;
grant execute on function public.liberar_orden_impresion(uuid, text) to authenticated;

revoke all on function public.resolver_orden_impresion(uuid, boolean, text) from public, anon;
grant execute on function public.resolver_orden_impresion(uuid, boolean, text) to authenticated;

revoke all on function public.mi_cola_de_impresion() from public, anon;
grant execute on function public.mi_cola_de_impresion() to authenticated;
