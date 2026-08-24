-- Un motivo mas: el cliente esta, pero no ahora.
alter type public.motivo_no_visita add value if not exists 'visitar_mas_tarde';

-- El vinculo que comparten tres cambios: saber que nota salio de que visita.
alter table public.notas_pedido
  add column if not exists parada_id uuid references public.paradas (id) on delete set null;

create index if not exists notas_pedido_parada_idx
  on public.notas_pedido (parada_id) where parada_id is not null;

comment on column public.notas_pedido.parada_id is
  'La parada del rol de visita desde la que se genero esta nota, si se genero desde ahi. Null en las que se cargan fuera del recorrido.';
