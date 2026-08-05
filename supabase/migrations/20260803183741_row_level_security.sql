-- =============================================================================
-- WoodTools · Rol de Visita
-- 0006 · Row Level Security
--
-- Regla general:
--   · vendedor   → sólo lo suyo, y sólo si su alta está aprobada
--   · supervisor → lectura de todo
--   · admin      → todo
-- =============================================================================

alter table public.perfiles            enable row level security;
alter table public.dispositivos        enable row level security;
alter table public.clientes            enable row level security;
alter table public.direcciones         enable row level security;
alter table public.roles_visita        enable row level security;
alter table public.paradas             enable row level security;
alter table public.visitas             enable row level security;
alter table public.posiciones_actuales enable row level security;
alter table public.posiciones          enable row level security;
alter table public.sesiones_app        enable row level security;
alter table public.configuracion       enable row level security;
alter table public.auditoria           enable row level security;

-- Nada es accesible sin sesión.
revoke all on all tables in schema public from anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- perfiles
-- ─────────────────────────────────────────────────────────────────────────────

-- Cada uno puede leer su propio perfil aunque esté pendiente: así la app puede
-- mostrar la pantalla "Tu cuenta espera aprobación".
create policy perfiles_leer_propio on public.perfiles
  for select to authenticated
  using (id = auth.uid());

create policy perfiles_leer_todos on public.perfiles
  for select to authenticated
  using (interno.puede_ver_todo());

-- Un vendedor puede editar sus datos de contacto, nunca su rol ni su estado.
create policy perfiles_editar_propio on public.perfiles
  for update to authenticated
  using (id = auth.uid() and interno.esta_habilitado())
  with check (
    id = auth.uid()
    and rol    = interno.rol_actual()
    and estado = interno.estado_actual()
  );

create policy perfiles_admin_todo on public.perfiles
  for all to authenticated
  using (interno.es_admin())
  with check (interno.es_admin());


-- ─────────────────────────────────────────────────────────────────────────────
-- dispositivos
-- ─────────────────────────────────────────────────────────────────────────────

create policy dispositivos_propios on public.dispositivos
  for select to authenticated
  using (perfil_id = auth.uid() or interno.puede_ver_todo());

-- La app registra su propio dispositivo, siempre como NO autorizado.
create policy dispositivos_registrar on public.dispositivos
  for insert to authenticated
  with check (perfil_id = auth.uid() and autorizado is false);

-- El dispositivo puede refrescar su telemetría (versión, último visto).
-- Que no pueda auto-autorizarse lo garantiza el trigger de abajo: hacerlo con
-- una subconsulta dentro de la política provocaría recursión infinita de RLS
-- sobre esta misma tabla.
create policy dispositivos_latido on public.dispositivos
  for update to authenticated
  using (perfil_id = auth.uid())
  with check (perfil_id = auth.uid());

create or replace function interno.proteger_autorizacion_dispositivo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Sólo un administrador cambia el estado de autorización de un teléfono.
  if new.autorizado is distinct from old.autorizado and not interno.es_admin() then
    new.autorizado     := old.autorizado;
    new.autorizado_por := old.autorizado_por;
    new.autorizado_en  := old.autorizado_en;
  end if;
  return new;
end;
$$;

create trigger dispositivos_proteger_autorizacion
  before update on public.dispositivos
  for each row execute function interno.proteger_autorizacion_dispositivo();

create policy dispositivos_admin on public.dispositivos
  for all to authenticated
  using (interno.es_admin())
  with check (interno.es_admin());


-- ─────────────────────────────────────────────────────────────────────────────
-- clientes y direcciones
-- ─────────────────────────────────────────────────────────────────────────────

-- El vendedor ve su cartera, más cualquier cliente que tenga asignado en el rol
-- de visita del día (por si le pasan una visita de otro vendedor).
create policy clientes_leer on public.clientes
  for select to authenticated
  using (
    interno.puede_ver_todo()
    or (
      interno.esta_habilitado()
      and (
        vendedor_id = auth.uid()
        or exists (
          select 1
            from public.paradas pa
            join public.roles_visita rv on rv.id = pa.rol_visita_id
           where pa.cliente_id = clientes.id
             and rv.vendedor_id = auth.uid()
        )
      )
    )
  );

create policy clientes_admin on public.clientes
  for all to authenticated
  using (interno.es_admin())
  with check (interno.es_admin());

create policy direcciones_leer on public.direcciones
  for select to authenticated
  using (
    interno.puede_ver_todo()
    or (
      interno.esta_habilitado()
      and (
        cliente_id is null
        or exists (select 1 from public.clientes c where c.id = direcciones.cliente_id)
      )
    )
  );

-- El vendedor puede dar de alta una dirección desde "AGREGAR NUEVO DESTINO".
create policy direcciones_crear on public.direcciones
  for insert to authenticated
  with check (interno.esta_habilitado());

create policy direcciones_admin on public.direcciones
  for all to authenticated
  using (interno.es_admin())
  with check (interno.es_admin());


-- ─────────────────────────────────────────────────────────────────────────────
-- roles_visita
-- ─────────────────────────────────────────────────────────────────────────────

create policy roles_visita_leer on public.roles_visita
  for select to authenticated
  using (
    interno.puede_ver_todo()
    or (vendedor_id = auth.uid() and interno.esta_habilitado())
  );

-- El vendedor puede abrir su propia jornada si la oficina todavía no la armó:
-- es lo que permite cargar un destino a mano sin depender de nadie.
create policy roles_visita_crear_propia on public.roles_visita
  for insert to authenticated
  with check (vendedor_id = auth.uid() and interno.esta_habilitado());

create policy roles_visita_editar_propio on public.roles_visita
  for update to authenticated
  using (vendedor_id = auth.uid() and interno.esta_habilitado())
  with check (vendedor_id = auth.uid());

create policy roles_visita_admin on public.roles_visita
  for all to authenticated
  using (interno.es_admin())
  with check (interno.es_admin());


-- ─────────────────────────────────────────────────────────────────────────────
-- paradas
-- ─────────────────────────────────────────────────────────────────────────────

create policy paradas_leer on public.paradas
  for select to authenticated
  using (
    interno.puede_ver_todo()
    or exists (
      select 1 from public.roles_visita rv
       where rv.id = paradas.rol_visita_id
         and rv.vendedor_id = auth.uid()
    )
  );

create policy paradas_escribir_propias on public.paradas
  for insert to authenticated
  with check (
    interno.esta_habilitado()
    and exists (
      select 1 from public.roles_visita rv
       where rv.id = paradas.rol_visita_id
         and rv.vendedor_id = auth.uid()
         and rv.estado in ('planificado', 'en_curso')
    )
  );

create policy paradas_actualizar_propias on public.paradas
  for update to authenticated
  using (
    interno.esta_habilitado()
    and exists (
      select 1 from public.roles_visita rv
       where rv.id = paradas.rol_visita_id and rv.vendedor_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.roles_visita rv
       where rv.id = paradas.rol_visita_id and rv.vendedor_id = auth.uid()
    )
  );

create policy paradas_admin on public.paradas
  for all to authenticated
  using (interno.es_admin())
  with check (interno.es_admin());


-- ─────────────────────────────────────────────────────────────────────────────
-- visitas
--
-- El parte se puede corregir el mismo día. Después queda cerrado: el histórico
-- es un registro, no un borrador.
-- ─────────────────────────────────────────────────────────────────────────────

create policy visitas_leer on public.visitas
  for select to authenticated
  using (interno.puede_ver_todo() or vendedor_id = auth.uid());

create policy visitas_crear_propias on public.visitas
  for insert to authenticated
  with check (vendedor_id = auth.uid() and interno.esta_habilitado());

create policy visitas_corregir_mismo_dia on public.visitas
  for update to authenticated
  using (
    vendedor_id = auth.uid()
    and interno.esta_habilitado()
    and registrado_en > now() - interval '18 hours'
  )
  with check (vendedor_id = auth.uid());

create policy visitas_admin on public.visitas
  for all to authenticated
  using (interno.es_admin())
  with check (interno.es_admin());


-- ─────────────────────────────────────────────────────────────────────────────
-- Seguimiento
-- ─────────────────────────────────────────────────────────────────────────────

create policy posiciones_actuales_leer on public.posiciones_actuales
  for select to authenticated
  using (interno.puede_ver_todo() or vendedor_id = auth.uid());

create policy posiciones_actuales_reportar on public.posiciones_actuales
  for insert to authenticated
  with check (vendedor_id = auth.uid() and interno.esta_habilitado());

create policy posiciones_actuales_refrescar on public.posiciones_actuales
  for update to authenticated
  using (vendedor_id = auth.uid() and interno.esta_habilitado())
  with check (vendedor_id = auth.uid());

create policy posiciones_leer on public.posiciones
  for select to authenticated
  using (interno.puede_ver_todo() or vendedor_id = auth.uid());

create policy posiciones_reportar on public.posiciones
  for insert to authenticated
  with check (vendedor_id = auth.uid() and interno.esta_habilitado());

create policy posiciones_admin on public.posiciones
  for all to authenticated
  using (interno.es_admin())
  with check (interno.es_admin());


create policy sesiones_leer on public.sesiones_app
  for select to authenticated
  using (interno.puede_ver_todo() or perfil_id = auth.uid());

create policy sesiones_propias on public.sesiones_app
  for insert to authenticated
  with check (perfil_id = auth.uid());

create policy sesiones_latido on public.sesiones_app
  for update to authenticated
  using (perfil_id = auth.uid())
  with check (perfil_id = auth.uid());


-- ─────────────────────────────────────────────────────────────────────────────
-- Configuración y auditoría
-- ─────────────────────────────────────────────────────────────────────────────

create policy configuracion_leer on public.configuracion
  for select to authenticated
  using (interno.esta_habilitado());

create policy configuracion_admin on public.configuracion
  for all to authenticated
  using (interno.es_admin())
  with check (interno.es_admin());

create policy auditoria_leer on public.auditoria
  for select to authenticated
  using (interno.puede_ver_todo());

create policy auditoria_escribir on public.auditoria
  for insert to authenticated
  with check (actor_id = auth.uid());


-- ─────────────────────────────────────────────────────────────────────────────
-- Realtime: el admin se suscribe a las posiciones en vivo
-- ─────────────────────────────────────────────────────────────────────────────

alter publication supabase_realtime add table public.posiciones_actuales;
alter publication supabase_realtime add table public.roles_visita;
alter publication supabase_realtime add table public.paradas;
