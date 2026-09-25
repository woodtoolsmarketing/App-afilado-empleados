-- Estas 3 tenian ademas un grant a PUBLIC del que anon heredaba EXECUTE, asi que
-- revocar de anon no alcanzo. authenticated tiene grant propio (authenticated=X),
-- por eso revocar de PUBLIC saca a anon sin dejar afuera a los usuarios logueados.
revoke execute on function public.completar_articulo(text, numeric, text) from public;
revoke execute on function public.crear_notas_pedido(jsonb) from public;
revoke execute on function public.reiniciar_talonario() from public;
