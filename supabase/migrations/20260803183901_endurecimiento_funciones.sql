-- =============================================================================
-- WoodTools · Rol de Visita
-- 0008 · Endurecimiento (hallazgos del linter de seguridad de Supabase)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Funciones que no deben quedar expuestas en /rest/v1/rpc
--
-- Por defecto, toda función de `public` queda invocable por REST. Las de trigger
-- no tienen por qué estarlo, y las de administración no tienen por qué figurar
-- para alguien sin sesión.
-- ─────────────────────────────────────────────────────────────────────────────

revoke execute on function public.manejar_nuevo_usuario() from anon, authenticated, public;
revoke execute on function interno.proteger_autorizacion_dispositivo() from anon, authenticated, public;

revoke execute on function public.podar_historial(date) from anon, public;
revoke execute on function public.resolver_alta_usuario(uuid, boolean, public.rol_usuario, text, text)
  from anon, public;

-- `podar_historial` y `resolver_alta_usuario` SÍ quedan invocables por
-- `authenticated`: así las llama el panel de escritorio. Las dos empiezan
-- verificando `interno.es_admin()` y cortan con 42501 si quien llama no lo es.
-- El linter las va a seguir reportando; es el comportamiento buscado.


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. search_path fijo
--
-- Sin `search_path` fijo, un rol que pueda crear objetos en algún esquema del
-- camino de búsqueda podría interponer una función propia y cambiar lo que
-- estas evalúan — incluidas las que deciden si alguien es administrador.
-- ─────────────────────────────────────────────────────────────────────────────

alter function interno.tocar_actualizado_en()         set search_path = public, pg_temp;
alter function interno.esta_habilitado()              set search_path = public, pg_temp;
alter function interno.es_admin()                     set search_path = public, pg_temp;
alter function interno.puede_ver_todo()               set search_path = public, pg_temp;
alter function interno.orden_temporal()               set search_path = pg_temp;
alter function interno.observacion_valida(text)       set search_path = pg_catalog, pg_temp;
alter function public.custom_access_token_hook(jsonb) set search_path = public, pg_temp;
