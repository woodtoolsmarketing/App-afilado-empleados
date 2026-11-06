-- Moneda del cobro: el vendedor a veces cobra en dólares. Los montos
-- (cheque/efectivo/retenciones/total) quedan en ESA moneda; la planilla los
-- muestra en columnas separadas (pesos y dólares). Default ARS para no tocar
-- los cobros viejos.
alter table public.cobranzas
  add column if not exists moneda text not null default 'ARS';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cobranzas_moneda_chk') then
    alter table public.cobranzas
      add constraint cobranzas_moneda_chk check (moneda in ('ARS', 'USD'));
  end if;
end $$;

comment on column public.cobranzas.moneda is
  'Moneda del cobro: ARS (pesos) o USD (dolares). cheque/efectivo/retenciones/total estan en esa moneda.';

-- editar_cobranza suma p_moneda. DROP+CREATE porque cambia la firma (sumar un
-- parametro crearia una sobrecarga ambigua). Default null: conserva la moneda
-- que ya tenia el cobro, para que las llamadas viejas del APK sigan andando.
drop function if exists public.editar_cobranza(uuid, text, numeric, numeric, numeric, text);

create function public.editar_cobranza(
  p_id          uuid,
  p_tipo        text,
  p_cheque      numeric,
  p_efectivo    numeric,
  p_retenciones numeric default null::numeric,
  p_comentarios text default null::text,
  p_moneda      text default null::text
)
returns public.cobranzas
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  actual        public.cobranzas;
  resultado     public.cobranzas;
  v_cheque      numeric := round(coalesce(p_cheque, 0), 2);
  v_efectivo    numeric := round(coalesce(p_efectivo, 0), 2);
  v_retenciones numeric;
  v_moneda      text;
begin
  select * into actual from public.cobranzas where id = p_id;
  if actual.id is null then
    raise exception 'No encontramos ese cobro.' using errcode = 'P0002';
  end if;

  v_retenciones := round(coalesce(p_retenciones, actual.retenciones, 0), 2);
  v_moneda := coalesce(nullif(btrim(coalesce(p_moneda, '')), ''), actual.moneda, 'ARS');

  if actual.vendedor_id <> auth.uid() or not interno.esta_habilitado() then
    raise exception 'No podés modificar este cobro.' using errcode = '42501';
  end if;

  if actual.impreso_en is not null then
    raise exception 'Esta cobranza ya se imprimió, así que no se puede modificar.'
      using errcode = '23514';
  end if;

  if p_tipo not in ('factura', 'presupuesto') then
    raise exception 'El comprobante tiene que ser factura o presupuesto.'
      using errcode = '23514';
  end if;

  if v_moneda not in ('ARS', 'USD') then
    raise exception 'La moneda tiene que ser ARS o USD.' using errcode = '23514';
  end if;

  if v_cheque < 0 or v_efectivo < 0 or v_retenciones < 0 then
    raise exception 'Los montos no pueden ser negativos.' using errcode = '23514';
  end if;

  if (v_cheque + v_efectivo + v_retenciones) <= 0 then
    raise exception 'Poné cuánto cobraste, en cheque, efectivo o retención.' using errcode = '23514';
  end if;

  update public.cobranzas
     set tipo_comprobante = p_tipo,
         cheque           = v_cheque,
         efectivo         = v_efectivo,
         retenciones      = v_retenciones,
         total            = round(v_cheque + v_efectivo + v_retenciones, 2),
         moneda           = v_moneda,
         comentarios      = nullif(btrim(coalesce(p_comentarios, '')), ''),
         actualizado_en   = now()
   where id = p_id
  returning * into resultado;

  return resultado;
end;
$function$;

revoke all on function public.editar_cobranza(uuid, text, numeric, numeric, numeric, text, text) from public, anon;
grant execute on function public.editar_cobranza(uuid, text, numeric, numeric, numeric, text, text) to authenticated;
