-- Función TEMPORAL para re-importar el listado de "Clientes habilitados" del
-- Gestión. Mismo esquema que importar-clientes.sql: security definer cerrada con
-- un secreto de un solo uso, que se crea ANTES de correr el .mjs y se BORRA
-- después (no queda dando vueltas una función que escribe en clientes).
--
-- ─── Pasos ────────────────────────────────────────────────────────────────────
--   1. Reemplazá PONER-EL-SECRETO-ACA por el mismo valor que tenés en el .env en
--      SECRETO_IMPORTACION (el que ya usás para importar el padrón).
--   2. Pegá todo esto en el SQL Editor de Supabase y ejecutá.
--   3. Corré:  SECRETO_IMPORTACION=... node herramientas/importar-habilitados.mjs <listado.pdf|.txt>
--   4. Cuando termine, borrá la función y la tabla de staging:
--        drop function if exists public.importar_habilitados_temporal(text, text[], boolean, boolean);
--        drop table if exists public._habilitados_staging;
--
-- ─── Qué hace el sync ───────────────────────────────────────────────────────
--   • HABILITA a los que están en el listado.
--   • DESHABILITA a los del PADRÓN (creado_por is null, no provisorio) que NO
--     están en el listado: así, cuando el Gestión saca a alguien de habilitados,
--     la app deja de mostrarlo.
--   • NO toca a los clientes creados en la app (creado_por not null): un cliente
--     que el vendedor cargó y la oficina confirmó queda habilitado aunque todavía
--     no figure en el listado del Gestión.
--   El listado se arma de a tandas en `_habilitados_staging`; el sync corre una
--   sola vez, en la última tanda (p_aplicar = true), cuando ya está completo.
--
-- ─── Dos detalles para la operación ──────────────────────────────────────────
--   • Es el mismo mecanismo con el que se cargó el filtro la primera vez: el
--     habilitado=true de los clientes del padrón vive en los datos, no en una
--     migración, así que un `db reset` en limpio dejaría a todos en false hasta
--     correr esto. (Hoy no aplica: la base es única y no se resetea.)
--   • El toggle a mano del panel sobre un cliente DE PADRÓN es efímero frente a
--     este re-import: si el cliente sigue en el listado del Gestión, vuelve a
--     quedar habilitado. Para una baja permanente, sacalo del listado del
--     Gestión o dalo de baja (activo=false). El toggle a true de un cliente
--     creado en la app SÍ sobrevive (no se lo toca).

create table if not exists public._habilitados_staging (codigo text primary key);
-- Nadie la toca directo: el acceso real pasa por la función security definer.
alter table public._habilitados_staging enable row level security;
revoke all on public._habilitados_staging from anon, authenticated;

create or replace function public.importar_habilitados_temporal(
  p_secreto text,
  p_codigos text[],
  p_reiniciar boolean default false,
  p_aplicar boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_hab    int := 0;
  v_deshab int := 0;
begin
  if p_secreto is distinct from 'PONER-EL-SECRETO-ACA' then
    raise exception 'Secreto inválido.' using errcode = '42501';
  end if;

  if p_reiniciar then
    truncate public._habilitados_staging;
  end if;

  -- Los códigos vienen como los dice la oficina (sin ceros de relleno). El
  -- mismo patrón que importar-clientes.sql, para que machee 1:1 con los códigos
  -- guardados: '^0+(?=[0-9])' quita ceros sólo si queda un dígito detrás.
  insert into public._habilitados_staging (codigo)
  select regexp_replace(btrim(x), '^0+(?=[0-9])', '')
    from unnest(p_codigos) x
   where btrim(x) <> ''
  on conflict do nothing;

  if not p_aplicar then
    return jsonb_build_object('cargados', (select count(*) from public._habilitados_staging));
  end if;

  update public.clientes c
     set habilitado = true, actualizado_en = now()
   where not c.habilitado
     and exists (select 1 from public._habilitados_staging s where s.codigo = c.codigo);
  get diagnostics v_hab = row_count;

  update public.clientes c
     set habilitado = false, actualizado_en = now()
   where c.habilitado
     and c.creado_por is null
     and not c.provisorio
     and not exists (select 1 from public._habilitados_staging s where s.codigo = c.codigo);
  get diagnostics v_deshab = row_count;

  return jsonb_build_object(
    'en_listado',   (select count(*) from public._habilitados_staging),
    'habilitados',  v_hab,
    'deshabilitados', v_deshab,
    'sin_cliente',  (select count(*) from public._habilitados_staging s
                      where not exists (select 1 from public.clientes c where c.codigo = s.codigo))
  );
end;
$$;

-- Mínimo privilegio, igual que importar-clientes.sql: nadie salvo la clave
-- anónima (que además necesita el secreto) la ejecuta.
revoke all on function public.importar_habilitados_temporal(text, text[], boolean, boolean) from public;
grant execute on function public.importar_habilitados_temporal(text, text[], boolean, boolean) to anon, authenticated;
