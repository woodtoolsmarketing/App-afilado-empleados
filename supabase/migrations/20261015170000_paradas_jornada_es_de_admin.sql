-- =============================================================================
-- WoodTools · paradas: excluir las del recorrido de un admin (fix del subquery)
--
-- La policy anterior de `paradas_leer` sacaba al dueño con un subquery a
-- `roles_visita`, pero ese subquery corre con la RLS del que mira: un supervisor
-- NO ve la fila de roles_visita del admin, así que el subquery devolvía NULL,
-- `es_de_admin(NULL)` daba false y la parada se colaba igual.
--
-- Se reemplaza por un helper SECURITY DEFINER que resuelve el dueño saltándose
-- la RLS (mismo patrón que `interno.rol_actual()`), así la exclusión es firme.
-- =============================================================================

create or replace function interno.jornada_es_de_admin(p_rol_visita_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1
    from public.roles_visita rv
    join public.perfiles p on p.id = rv.vendedor_id
    where rv.id = p_rol_visita_id and p.rol = 'admin'
  );
$$;

comment on function interno.jornada_es_de_admin(uuid) is
  'TRUE si el recorrido (roles_visita) es de un admin. SECURITY DEFINER para que la RLS de paradas lo evalúe sin depender de que el que mira pueda ver la jornada.';

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
      and not interno.jornada_es_de_admin(paradas.rol_visita_id)
    )
  );
