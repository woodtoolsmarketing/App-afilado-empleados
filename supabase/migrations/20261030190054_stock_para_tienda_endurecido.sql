-- =============================================================================
-- WoodTools · endurecer la fuente de stock para Tiendanube (defensa en capas)
--
-- stock_para_tienda gatea el stock (codigo->cantidad) por un token compartido
-- con pagina-wt. Se agregan capas, SIN cortar la sync (la oficina sigue mandando
-- el MISMO token; sólo cambia cómo lo validamos acá). Simulado end-to-end en una
-- transacción revertida antes de aplicar (930 filas con token válido, 0 sin él,
-- rotación, auditoría y rate-limit verificados), y probado con el empujar-stock.js
-- real en seco.
--
--  1. Token HASHEADO en reposo (sha256): `configuracion` ya no guarda el token en
--     claro; se compara el hash. Leer esa tabla no entrega un token usable.
--  2. ROTACIÓN sin downtime: `stock_tienda_token_hash` (actual) + opcionalmente
--     `stock_tienda_token_hash_prev` con `stock_tienda_token_prev_hasta` (el token
--     viejo sigue valiendo hasta esa fecha mientras se actualiza el fuente-stock).
--  3. AUDITORÍA: `interno.stock_tienda_accesos` registra cada llamada (acotada:
--     se poda a 30 días y el log de inválidas se limita por minuto).
--  4. RATE-LIMIT: el token válido legítimo (1/hora) nunca se frena, pero un token
--     filtrado que scrapee se corta a 10/min, y el martilleo inválido se audita
--     acotado. (La defensa de volumen fina va en la plataforma; acá lo barato.)
--  5. GRANTS: sólo `anon` (lo usa el script con la anon key) — se saca
--     `authenticated` y `public`.
--  6. Mínimo dato: sigue devolviendo sólo codigo + cantidad (ni precios ni costos).
-- =============================================================================

-- 1) Migrar el token en claro -> hash, y borrar el claro.
insert into public.configuracion (clave, valor, descripcion)
select 'stock_tienda_token_hash',
       to_jsonb(encode(extensions.digest((valor #>> '{}'), 'sha256'), 'hex')),
       'Hash SHA-256 del token de stock_para_tienda. El token en claro vive sólo en el fuente-stock.json de la oficina, no en la base.'
from public.configuracion where clave = 'stock_tienda_token'
on conflict (clave) do update set valor = excluded.valor, actualizado_en = now();

delete from public.configuracion where clave = 'stock_tienda_token';

-- 2) Auditoría (schema interno, NO expuesto por PostgREST).
create table if not exists interno.stock_tienda_accesos (
  id     bigint generated always as identity primary key,
  en     timestamptz not null default now(),
  ok     boolean     not null,
  filas  integer     not null default 0,
  motivo text        not null
);
create index if not exists stock_tienda_accesos_en on interno.stock_tienda_accesos (en);

-- 3) Función endurecida (ahora VOLATILE porque audita).
create or replace function public.stock_para_tienda(p_token text)
returns table(codigo text, cantidad integer)
language plpgsql
volatile
security definer
set search_path = public, interno, extensions, pg_temp
as $fn$
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
$fn$;

-- 5) Grants: sólo anon (el script pega con la anon key + token).
revoke all on function public.stock_para_tienda(text) from public, authenticated;
grant execute on function public.stock_para_tienda(text) to anon;

comment on function public.stock_para_tienda(text) is
  'Devuelve codigo->cantidad de stock_articulos si p_token coincide (hash sha256) con el token de la tienda. Capas: hash en reposo, rotación (hash_prev + prev_hasta), auditoría (interno.stock_tienda_accesos) y rate-limit. SECURITY DEFINER; sólo anon. Fuente de la sync de stock hacia Tiendanube.';
