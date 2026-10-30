-- =============================================================================
-- WoodTools · fuente de stock para la tienda online (Tiendanube)
--
-- La tienda online (woodtools.ar / Tiendanube) tiene que reflejar el stock que
-- carga la oficina acá. Un script externo —pagina-wt/_tools/tiendanube/
-- empujar-stock.js— lee `codigo -> cantidad` por esta RPC y le escribe el stock
-- a cada variante de la tienda, matcheando por SKU = código.
--
-- El script NO es un usuario (no tiene login), así que la RPC se gatea por un
-- TOKEN (secreto compartido, guardado en `configuracion`), no por RLS. Con el
-- token devuelve el stock; sin el token, nada. Se expone a `anon` porque el
-- script pega con la anon key + el token; la data real la protege el token.
-- =============================================================================

-- Token secreto (se genera una vez; on conflict do nothing lo deja estable).
insert into public.configuracion (clave, valor, descripcion)
values ('stock_tienda_token',
        to_jsonb(encode(extensions.gen_random_bytes(24), 'hex')),
        'Secreto compartido con pagina-wt para leer el stock hacia la tienda online (stock_para_tienda).')
on conflict (clave) do nothing;

create or replace function public.stock_para_tienda(p_token text)
returns table(codigo text, cantidad integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select s.codigo, s.cantidad
  from public.stock_articulos s
  where p_token is not null
    and p_token = (select valor #>> '{}' from public.configuracion where clave = 'stock_tienda_token')
  order by s.codigo
$fn$;

revoke all on function public.stock_para_tienda(text) from public;
grant execute on function public.stock_para_tienda(text) to anon, authenticated;

comment on function public.stock_para_tienda(text) is
  'Devuelve codigo->cantidad de stock_articulos si p_token coincide con configuracion.stock_tienda_token. Fuente de la sync de stock hacia la tienda online (Tiendanube). SECURITY DEFINER + token porque el script externo no es un usuario.';
