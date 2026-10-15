-- =============================================================================
-- WoodTools · la cobranza se puede corregir hasta que se imprime
--
-- Antes la corrección era por ventana de tiempo (`cobranzas_corregir_hoy`: el
-- vendedor podía editar su cobro durante 18 h). El criterio real del negocio es
-- otro: se corrige MIENTRAS no haya salido en papel. Una vez impresa la
-- rendición, el papel ya está en la calle y la cifra no se toca más.
--
-- 1) `impreso_en`: cuándo salió en papel este cobro. NULL = todavía editable.
-- 2) `editar_cobranza`: corrige montos/tipo/comentario si no está impreso.
-- 3) `marcar_cobranzas_impresas`: sella los cobros del día al imprimir.
--
-- Las tres validaciones de siempre (cheque+efectivo=total, total>0, no
-- negativos) las sigue garantizando el CHECK de la tabla; acá se recalcula el
-- total para que cierre.
-- =============================================================================

alter table public.cobranzas
  add column if not exists impreso_en timestamptz;

comment on column public.cobranzas.impreso_en is
  'Cuándo salió en papel la rendición de este cobro. Mientras es NULL el vendedor puede corregirlo; una vez impreso queda cerrado.';

-- La corrección deja de ser por ventana de 18 h. Todo pasa ahora por
-- `editar_cobranza` (SECURITY DEFINER, con su chequeo de impreso), así que no
-- hace falta dejar abierta una política de UPDATE directo a la tabla.
drop policy if exists cobranzas_corregir_hoy on public.cobranzas;


-- ─────────────────────────────────────────────────────────────────────────────
-- Corregir un cobro
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.editar_cobranza(
  p_id          uuid,
  p_tipo        text,
  p_cheque      numeric,
  p_efectivo    numeric,
  p_comentarios text default null
)
returns public.cobranzas
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actual    public.cobranzas;
  resultado public.cobranzas;
  v_cheque   numeric := round(coalesce(p_cheque, 0), 2);
  v_efectivo numeric := round(coalesce(p_efectivo, 0), 2);
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

  if v_cheque < 0 or v_efectivo < 0 then
    raise exception 'Los montos no pueden ser negativos.' using errcode = '23514';
  end if;

  if (v_cheque + v_efectivo) <= 0 then
    raise exception 'Poné cuánto cobraste, en cheque o en efectivo.' using errcode = '23514';
  end if;

  update public.cobranzas
     set tipo_comprobante = p_tipo,
         cheque           = v_cheque,
         efectivo         = v_efectivo,
         total            = round(v_cheque + v_efectivo, 2),
         comentarios      = nullif(btrim(coalesce(p_comentarios, '')), ''),
         actualizado_en   = now()
   where id = p_id
  returning * into resultado;

  return resultado;
end;
$$;

revoke all on function public.editar_cobranza(uuid, text, numeric, numeric, text) from public, anon;
grant execute on function public.editar_cobranza(uuid, text, numeric, numeric, text) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- Sellar los cobros de unos días como impresos
--
-- La llama la app cuando el vendedor imprime la rendición junto con las notas, y
-- el panel cuando la oficina imprime la planilla. Sólo pisa los que todavía no
-- tienen sello, así que reimprimir no corre la fecha. Devuelve cuántos selló.
--
-- `p_vendedor_id` lo usa el panel para sellar los de un vendedor; un vendedor
-- sólo puede sellar los suyos (si manda otro id, se ignora).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.marcar_cobranzas_impresas(
  p_fechas      date[],
  p_vendedor_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  objetivo uuid;
  sellados integer;
begin
  if not interno.esta_habilitado() then
    raise exception 'Tu cuenta no está habilitada.' using errcode = '42501';
  end if;

  -- El panel (admin) puede sellar los de otro vendedor; cualquier otro, sólo
  -- los propios.
  if p_vendedor_id is not null and interno.es_admin() then
    objetivo := p_vendedor_id;
  else
    objetivo := auth.uid();
  end if;

  update public.cobranzas
     set impreso_en = now()
   where vendedor_id = objetivo
     and fecha = any(p_fechas)
     and impreso_en is null;

  get diagnostics sellados = row_count;
  return sellados;
end;
$$;

revoke all on function public.marcar_cobranzas_impresas(date[], uuid) from public, anon;
grant execute on function public.marcar_cobranzas_impresas(date[], uuid) to authenticated;
