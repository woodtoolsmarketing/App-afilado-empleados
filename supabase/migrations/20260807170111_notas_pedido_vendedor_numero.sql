-- =============================================================================
-- El número de vendedor queda guardado en la nota.
--
-- Hasta ahora se leía del perfil al imprimir. Eso tiene dos problemas: si el
-- perfil no tiene código cargado la nota sale sin número de vendedor, y si
-- alguna vez se le cambia el código, las notas viejas cambian solas — un
-- comprobante emitido no puede reescribirse por un cambio posterior.
--
-- Se guarda en el alta, con lo que tenga el perfil en ese momento y lo que el
-- vendedor haya corregido a mano.
-- =============================================================================

alter table public.notas_pedido
  add column if not exists vendedor_numero text;

comment on column public.notas_pedido.vendedor_numero is
  'Número de vendedor tal como se emitió la nota. Congelado: no sigue al perfil.';

-- Las notas ya emitidas se completan con lo que hoy dice el perfil, que es lo
-- que se venía imprimiendo.
update public.notas_pedido n
   set vendedor_numero = p.codigo_vendedor
  from public.perfiles p
 where p.id = n.vendedor_id
   and n.vendedor_numero is null
   and p.codigo_vendedor is not null;
