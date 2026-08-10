-- =============================================================================
-- Cada talonario numera por su cuenta
--
-- La versión de prueba tiene que empezar de cero, y no alcanzaba con reiniciar
-- un contador: `numero` era único en toda la tabla, así que la primera nota de
-- la beta habría chocado con la número 1 de siempre.
--
-- La unicidad pasa a ser **por variante**, que es lo que en realidad significa:
-- dos talonarios distintos pueden tener los dos una hoja número 1. Y la beta
-- saca sus números de su propia secuencia, así que las notas de prueba no se
-- llevan comprobantes que después faltan en la numeración real.
-- =============================================================================

alter table public.notas_pedido
  add column if not exists variante text not null default 'produccion';

comment on column public.notas_pedido.variante is
  'Que app genero la nota: produccion, interno o beta. La beta numera aparte para no gastar numeros del talonario real.';

alter table public.notas_pedido
  drop constraint if exists notas_pedido_variante_valida;
alter table public.notas_pedido
  add constraint notas_pedido_variante_valida
  check (variante in ('produccion', 'interno', 'beta'));

alter table public.notas_pedido drop constraint if exists notas_pedido_numero_key;

create unique index if not exists notas_pedido_numero_por_variante
  on public.notas_pedido (variante, numero)
  where numero is not null;

create sequence if not exists public.notas_pedido_numero_beta_seq start with 1;
grant usage, select on sequence public.notas_pedido_numero_beta_seq to authenticated;

create or replace function interno.asignar_numero_nota()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
begin
  if new.numero is null and new.estado <> 'pendiente_cliente' then
    -- Cada talonario tiene su contador. La beta no gasta numeros del real.
    if new.variante = 'beta' then
      new.numero := nextval('public.notas_pedido_numero_beta_seq');
    else
      new.numero := nextval('public.notas_pedido_numero_seq');
    end if;
  end if;
  return new;
end;
$fn$;

revoke execute on function interno.asignar_numero_nota() from anon, authenticated, public;
