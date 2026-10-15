-- =============================================================================
-- WoodTools · el supervisor ve los recorridos de todos, menos los de un admin
--
-- `interno.puede_ver_todo()` (admin + supervisor + administración) dejaba leer
-- TODAS las filas de roles_visita / paradas / visitas, sin distinguir de quién
-- eran. El pedido: admin ve todo; supervisor (y administración) ven todo MENOS
-- los recorridos de usuarios con rol admin.
--
-- El admin sigue viendo todo por su policy propia `*_admin` (ALL, es_admin()),
-- que se OR-ea con la de lectura. Acá sólo se restringe la rama "ve todo" de las
-- policies de SELECT, que es la que usan supervisor y administración.
--
-- `es_de_admin(uuid)` va SECURITY DEFINER para leer `perfiles` sin recursión de
-- RLS, mismo patrón que `interno.rol_actual()`. Es un lookup por PK: barato aun
-- evaluado por fila.
-- =============================================================================

create or replace function interno.es_de_admin(p_perfil_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from public.perfiles where id = p_perfil_id and rol = 'admin'
  );
$$;

comment on function interno.es_de_admin(uuid) is
  'TRUE si ese perfil es admin. Se usa en RLS para que supervisor/administración no vean los recorridos de un admin.';


-- roles_visita: el dueño es `vendedor_id`.
alter policy roles_visita_leer on public.roles_visita
  using (
    (vendedor_id = auth.uid() and interno.esta_habilitado())
    or (interno.puede_ver_todo() and not interno.es_de_admin(vendedor_id))
  );

-- paradas: el dueño es el de su jornada (roles_visita.vendedor_id).
alter policy paradas_leer on public.paradas
  using (
    (
      interno.esta_habilitado()
      and exists (
        select 1 from public.roles_visita rv
        where rv.id = paradas.rol_visita_id and rv.vendedor_id = auth.uid()
      )
    )
    or (
      interno.puede_ver_todo()
      and not interno.es_de_admin(
        (select rv.vendedor_id from public.roles_visita rv where rv.id = paradas.rol_visita_id)
      )
    )
  );

-- visitas: el dueño es `vendedor_id`.
alter policy visitas_leer on public.visitas
  using (
    (vendedor_id = auth.uid())
    or (interno.puede_ver_todo() and not interno.es_de_admin(vendedor_id))
  );
