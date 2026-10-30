-- =============================================================================
-- WoodTools · editar_cobranza preserva la retencion si no se la mandan
--
-- p_retenciones tenia DEFAULT 0, pensado para que la APK vieja (que no manda ese
-- argumento) siguiera resolviendo la funcion. Pero en un EDIT eso es CON
-- PERDIDA: si el cobro YA tenia una retencion y el que llama la omite, el 0 por
-- defecto la pisa y achica el total. Ahora el default es NULL y, cuando llega
-- NULL (= "no me la mandaron"), se PRESERVA la retencion que ya tenia el cobro.
-- La APK nueva siempre manda el valor (incluido 0 explicito); la vieja preserva
-- lo que habia. Misma firma => CREATE OR REPLACE (no cambia la resolucion).
-- =============================================================================

create or replace function public.editar_cobranza(
  p_id          uuid,
  p_tipo        text,
  p_cheque      numeric,
  p_efectivo    numeric,
  p_retenciones numeric default null,
  p_comentarios text default null
)
returns public.cobranzas
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actual        public.cobranzas;
  resultado     public.cobranzas;
  v_cheque      numeric := round(coalesce(p_cheque, 0), 2);
  v_efectivo    numeric := round(coalesce(p_efectivo, 0), 2);
  v_retenciones numeric;
begin
  select * into actual from public.cobranzas where id = p_id;
  if actual.id is null then
    raise exception 'No encontramos ese cobro.' using errcode = 'P0002';
  end if;

  -- NULL = el que llama no mando retencion (p.ej. una APK vieja): se PRESERVA la
  -- que el cobro ya tenia, no se pisa con 0.
  v_retenciones := round(coalesce(p_retenciones, actual.retenciones, 0), 2);

  -- Solo el dueño del cobro, y habilitado.
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
         comentarios      = nullif(btrim(coalesce(p_comentarios, '')), ''),
         actualizado_en   = now()
   where id = p_id
  returning * into resultado;

  return resultado;
end;
$$;

revoke all on function public.editar_cobranza(uuid, text, numeric, numeric, numeric, text) from public, anon;
grant execute on function public.editar_cobranza(uuid, text, numeric, numeric, numeric, text) to authenticated;
