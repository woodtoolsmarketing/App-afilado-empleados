-- =============================================================================
-- WoodTools · retenciones en las cobranzas
--
-- El vendedor cobra parte del comprobante con una RETENCIÓN: el cliente retiene
-- un importe (impuestos) y entrega un certificado en lugar de plata. Esa
-- retención salda parte del comprobante igual que el cheque y el efectivo, así
-- que es una forma de pago más: el total pasa a ser cheque + efectivo +
-- retenciones.
--
-- 1) `retenciones`: importe retenido (default 0, no negativo).
-- 2) El CHECK que hace cerrar la planilla pasa a incluir la retención.
-- 3) `editar_cobranza` recibe la retención y recalcula el total con ella.
--
-- Compatibilidad: la columna y el parámetro nuevo tienen DEFAULT 0, así que la
-- APK que hoy está en la flota sigue andando aunque esta migración entre antes
-- que la APK nueva: inserta/edita sin retención y el CHECK redefinido las sigue
-- cumpliendo (cheque + efectivo + 0 = total). Lo mismo para las filas viejas.
-- =============================================================================

alter table public.cobranzas
  add column if not exists retenciones numeric(14, 2) not null default 0 check (retenciones >= 0);

comment on column public.cobranzas.retenciones is
  'Importe retenido por el cliente (certificado de retención). Es una forma de pago más: suma al total junto con cheque y efectivo.';

-- Las TRES formas tienen que sumar el total. Un CHECK no se altera: se
-- reemplaza (drop + add). Las filas viejas tienen retenciones = 0, así que la
-- condición nueva es equivalente a la anterior para ellas.
alter table public.cobranzas drop constraint if exists cobranzas_formas_suman;
alter table public.cobranzas
  add constraint cobranzas_formas_suman check (cheque + efectivo + retenciones = total);


-- ─────────────────────────────────────────────────────────────────────────────
-- Corregir un cobro — ahora con retenciones
--
-- Sumar un parámetro cambia la firma, así que no alcanza CREATE OR REPLACE
-- (dejaría la versión vieja de 5 argumentos como una sobrecarga ambigua): se
-- dropea la firma anterior y se crea la nueva. `p_retenciones` va con DEFAULT 0
-- para que la app vieja —que llama sin ese argumento— siga resolviendo contra
-- esta función (la retención toma 0) hasta que salga la APK nueva.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.editar_cobranza(uuid, text, numeric, numeric, text);

create function public.editar_cobranza(
  p_id          uuid,
  p_tipo        text,
  p_cheque      numeric,
  p_efectivo    numeric,
  p_retenciones numeric default 0,
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
  v_retenciones numeric := round(coalesce(p_retenciones, 0), 2);
begin
  select * into actual from public.cobranzas where id = p_id;
  if actual.id is null then
    raise exception 'No encontramos ese cobro.' using errcode = 'P0002';
  end if;

  -- Sólo el dueño del cobro, y habilitado. Un admin corrige desde el panel con
  -- su propio camino; acá es el vendedor sobre lo suyo.
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
