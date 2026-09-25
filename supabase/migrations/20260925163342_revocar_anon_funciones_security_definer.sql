-- Estas funciones son SECURITY DEFINER: saltean RLS. Con el anon key (que viaja en
-- el bundle de la app) cualquiera las ejecutaba sin login. Se le saca EXECUTE a anon.
-- email_para_ingreso NO se toca: la usa el login antes de autenticar.
revoke execute on function public.clientes_en_mapa() from anon;
revoke execute on function public.completar_articulo(text, numeric, text) from anon;
revoke execute on function public.crear_notas_pedido(jsonb) from anon;
revoke execute on function public.cuando_se_da_frecuente(text, integer) from anon;
revoke execute on function public.fichar(double precision, double precision) from anon;
revoke execute on function public.reiniciar_talonario() from anon;
revoke execute on function public.ubicacion_de_nota(uuid) from anon;
revoke execute on function public.vendedor_de_zona(text) from anon;
