-- =============================================================================
-- "Ultimo acceso" no contestaba la pregunta que el panel hace.
--
-- ── Que estaba pasando ──────────────────────────────────────────────────────
--
-- El Tablero y la pagina de Usuarios muestran `perfiles.ultimo_acceso_en`, y
-- ese campo se escribe en UN solo lugar: cuando alguien tipea usuario y
-- contrasena. Pero la sesion de esta app NO VENCE —lo que protege la app es el
-- desbloqueo del telefono, no un login que expira—, asi que el vendedor tipea
-- la contrasena una vez en su vida y no vuelve a pasar por ahi nunca mas.
--
-- Resultado: la columna decia "nunca" para gente que abrio la app ayer.
--
-- ── Lo que si estaba registrado ─────────────────────────────────────────────
--
-- Tres cosas, las tres escritas en cada arranque de la app, y ninguna de las
-- tres visible en el Tablero ni en Usuarios:
--
--   dispositivos.ultimo_visto_en      cada vez que la app verifica el aparato
--   presencias.ultima_actividad_en    la actividad del dia, con las aperturas
--   sesiones_app.ultimo_latido        el latido de la sesion abierta
--
-- O sea que el dato existia y estaba fresco. Lo que faltaba era mirarlo.
--
-- ── Que hace esta vista ─────────────────────────────────────────────────────
--
-- Devuelve, por persona, la ULTIMA SENAL DE VIDA: el maximo de las cuatro
-- fuentes, y de cual salio. Se toma el maximo y no una sola porque cada una se
-- escribe en un momento distinto y ninguna cubre todos los casos: el que entra
-- al panel desde la PC no toca `dispositivos`, y el que abre la app y no marca
-- entrada no toca `presencias`.
--
-- `security_invoker` para que siga valiendo RLS: el admin y el supervisor ven a
-- todos, y el vendedor se ve a si mismo.
-- =============================================================================

create or replace view public.vista_ultima_conexion
with (security_invoker = true) as
select
  p.id                                as perfil_id,
  p.nombre_completo,
  p.codigo_vendedor,
  p.rol,
  p.estado,

  /* La ultima senal de vida, venga de donde venga. */
  greatest(
    p.ultimo_acceso_en,
    d.visto,
    pr.actividad,
    s.latido
  )                                   as ultima_conexion,

  /*
   * De donde salio.
   *
   * No es adorno: "tipeo la contrasena" y "abrio la app" son cosas distintas y
   * el que mira el panel tiene que poder distinguirlas. Sobre todo mientras
   * queden perfiles viejos con `ultimo_acceso_en` en null.
   */
  case
    when greatest(p.ultimo_acceso_en, d.visto, pr.actividad, s.latido) is null then null
    when greatest(p.ultimo_acceso_en, d.visto, pr.actividad, s.latido) = pr.actividad then 'usando la app'
    when greatest(p.ultimo_acceso_en, d.visto, pr.actividad, s.latido) = s.latido     then 'sesion abierta'
    when greatest(p.ultimo_acceso_en, d.visto, pr.actividad, s.latido) = d.visto      then 'abrio la app'
    else 'inicio sesion'
  end                                 as de_donde,

  /* Las cuatro por separado, para poder mirar el detalle sin otra consulta. */
  p.ultimo_acceso_en                  as inicio_sesion_en,
  d.visto                             as app_abierta_en,
  pr.actividad                        as actividad_en,
  s.latido                            as latido_en,
  d.cuantos_aparatos,
  pr.aperturas_hoy

from public.perfiles p

left join lateral (
  select max(dd.ultimo_visto_en) as visto,
         count(*) filter (where dd.autorizado) as cuantos_aparatos
    from public.dispositivos dd
   where dd.perfil_id = p.id
) d on true

left join lateral (
  select max(prr.ultima_actividad_en) as actividad,
         max(prr.aperturas) filter (
           where prr.fecha = (now() at time zone 'America/Argentina/Buenos_Aires')::date
         ) as aperturas_hoy
    from public.presencias prr
   where prr.vendedor_id = p.id
) pr on true

left join lateral (
  select max(ss.ultimo_latido) as latido
    from public.sesiones_app ss
   where ss.perfil_id = p.id
) s on true;

comment on view public.vista_ultima_conexion is
  'La ultima senal de vida de cada persona: el maximo entre tipear la contrasena, abrir la app, la actividad del dia y el latido de la sesion.';

grant select on public.vista_ultima_conexion to authenticated;
