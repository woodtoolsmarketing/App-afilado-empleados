-- Las 3 RPC nuevas nacieron con grant a PUBLIC (del que anon hereda). authenticated
-- tiene grant propio, asi que revocar de PUBLIC saca a anon sin dejar afuera al login.
revoke execute on function public.proponer_cambio_direccion(uuid, uuid, text, double precision, double precision, text) from public;
revoke execute on function public.aplicar_cambio_direccion(uuid) from public;
revoke execute on function public.rechazar_cambio_direccion(uuid, text) from public;
