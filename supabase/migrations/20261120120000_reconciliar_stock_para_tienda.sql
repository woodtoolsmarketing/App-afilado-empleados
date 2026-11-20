-- =============================================================================
-- RECONCILIAR la fuente del sync de stock -> Tienda Nube.
--
-- La RPC `stock_para_tienda` y su tabla de auditoria `interno.stock_tienda_accesos`
-- VIVEN en la base de produccion (las usa `empujar-stock.js` del repo `pagina-wt`
-- cada hora), pero nunca se habian versionado en el repo: se aplicaron por
-- `apply_migration` sin reconciliar el .sql local (gotcha conocido del proyecto).
-- Esta migracion captura la definicion EXACTA de la base para que un `db reset`
-- o un entorno nuevo las recree; en la base viva es idempotente (create ... if
-- not exists + create or replace), asi que no hace falta aplicarla ahi.
--
-- El TOKEN no va aca: vive como HASH en la tabla `configuracion`
-- (clave `stock_tienda_token_hash`), que es DATO (secreto), no esquema. Tras un
-- rebuild hay que volver a cargarlo, como cualquier fila de configuracion.
--
-- Depende de objetos que ya crean migraciones anteriores: el schema `interno`,
-- las tablas `public.configuracion` y `public.stock_articulos`, y `extensions.digest`
-- (pgcrypto). Por eso va con fecha de hoy: corre despues de todos ellos.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. La auditoria de accesos a la RPC (poda + rate-limit se apoyan en ella)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists interno.stock_tienda_accesos (
  id     bigint generated always as identity primary key,
  en     timestamptz not null default now(),
  ok     boolean     not null,
  filas  integer     not null default 0,
  motivo text        not null
);

comment on table interno.stock_tienda_accesos is
  'Auditoria de llamadas a stock_para_tienda (ok/invalida, filas, motivo). La poda de 30 dias y el rate-limit la leen. Vive en interno: no se expone por la API.';

-- La poda (`en < now() - 30 dias`) y los conteos por minuto filtran por `en`.
create index if not exists stock_tienda_accesos_en
  on interno.stock_tienda_accesos using btree (en);


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. La RPC: stock de `stock_articulos` si el token (por hash) coincide
--
-- Definicion tal cual esta en produccion (pg_get_functiondef). Capas de defensa:
-- compara HASHES (no el token, evita timing-leak), soporta rotacion
-- (hash_prev + prev_hasta), audita y limita la tasa. SECURITY DEFINER; la gatea
-- el token, no la RLS.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.stock_para_tienda(p_token text)
 RETURNS TABLE(codigo text, cantidad integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'interno', 'extensions', 'pg_temp'
AS $function$
declare
  v_hash           text;
  v_valido         boolean := false;
  v_validos_min    int;
  v_invalidos_min  int;
  c_valido_max         constant int := 10;  -- válidas por minuto (legítimo: 1/hora)
  c_invalido_log_max   constant int := 20;  -- tope de auditoría de inválidas por minuto
begin
  -- Comparar HASHES (no el token) evita timing-leak del secreto.
  if p_token is not null and length(p_token) between 10 and 200 then
    v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
    v_valido :=
      exists(select 1 from public.configuracion
             where clave = 'stock_tienda_token_hash' and valor #>> '{}' = v_hash)
      or exists(select 1 from public.configuracion c
             where c.clave = 'stock_tienda_token_hash_prev' and c.valor #>> '{}' = v_hash
               and coalesce((select (valor #>> '{}')::timestamptz
                             from public.configuracion where clave = 'stock_tienda_token_prev_hasta'),
                            'epoch'::timestamptz) > now());
  end if;

  -- Poda barata (la auditoría no crece infinito).
  delete from interno.stock_tienda_accesos where en < now() - interval '30 days';

  if v_valido then
    select count(*) into v_validos_min
      from interno.stock_tienda_accesos where ok and en > now() - interval '1 minute';
    if v_validos_min >= c_valido_max then
      insert into interno.stock_tienda_accesos(ok, filas, motivo) values (false, 0, 'rate-limit (valido)');
      return;  -- un scraper con token filtrado se corta
    end if;
    insert into interno.stock_tienda_accesos(ok, filas, motivo)
      values (true, (select count(*) from public.stock_articulos), 'ok');
    return query select s.codigo, s.cantidad from public.stock_articulos s order by s.codigo;
  else
    select count(*) into v_invalidos_min
      from interno.stock_tienda_accesos where not ok and en > now() - interval '1 minute';
    if v_invalidos_min < c_invalido_log_max then
      insert into interno.stock_tienda_accesos(ok, filas, motivo) values (false, 0, 'token invalido');
    end if;
    return;  -- vacío
  end if;
end;
$function$;

comment on function public.stock_para_tienda(text) is
  'Devuelve codigo->cantidad de stock_articulos si p_token coincide (hash sha256) con el token de la tienda. Capas: hash en reposo, rotación (hash_prev + prev_hasta), auditoría (interno.stock_tienda_accesos) y rate-limit. SECURITY DEFINER; sólo anon. Fuente de la sync de stock hacia Tiendanube.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Permisos: sólo `anon` (la llave de empujar-stock.js) y `service_role`.
--
-- Se revoca el EXECUTE que por defecto tiene PUBLIC: la RPC maneja un secreto,
-- no puede quedar abierta a cualquiera. Espejo del ACL vivo
-- {postgres, anon, service_role}: `authenticated` NO la ejecuta.
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on function public.stock_para_tienda(text) from public;
grant execute on function public.stock_para_tienda(text) to anon, service_role;
