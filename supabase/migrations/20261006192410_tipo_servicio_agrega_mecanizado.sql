-- El mecanizado del agujero (achicar con buje / agrandar) es un servicio mas.
-- Solo aplica a sierras y fresas; su codigo de computo sale de la herramienta y
-- la operacion, no de una medida. Va en su propia migracion y sin usar el valor
-- en la misma transaccion: Postgres no deja usar un valor de enum recien agregado
-- hasta que la transaccion que lo agrega termina.
alter type public.tipo_servicio add value if not exists 'mecanizado';
