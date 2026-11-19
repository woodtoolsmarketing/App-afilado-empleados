-- =============================================================================
-- Push a los vendedores en dos eventos que hoy NO avisaban nada:
--
--   1. STOCK AGOTADO: cuando una VENTA deja un producto en 0, se avisa a todos
--      los vendedores (para que no lo ofrezcan). Va por `descontar_stock` —el
--      camino de la venta—, así la carga masiva de stock (`fijar_stock_masivo`)
--      y los ajustes manuales NO disparan push (no spamean a toda la flota).
--   2. REPORTE RESPONDIDO: cuando la oficina responde el reporte de un vendedor
--      (aparece `respuesta`), se le avisa a ESE vendedor con la respuesta.
--
-- Todo server-side: el teléfono y el panel reciben/escriben igual que hoy, no
-- hace falta recompilar ni la app ni el panel. El envío sale directo al servicio
-- de Expo por `pg_net` (la misma API que usa la Edge Function `enviar-push`),
-- con el canal 'recorrido' (el único que la app registra). Best-effort: un fallo
-- del aviso NUNCA voltea la venta ni la respuesta.
--
-- pg_net se instaló en la migración `instalar_pg_net`.
-- =============================================================================

-- ── Helper: manda un push a una lista de tokens ─────────────────────────────
create or replace function interno.notificar_push(
  p_tokens text[],
  p_titulo text,
  p_cuerpo text,
  p_datos  jsonb default '{}'::jsonb
) returns void
 language plpgsql
 security definer
 set search_path to 'public', 'interno', 'pg_temp'
as $$
declare
  v_tokens text[];
  v_body   jsonb;
begin
  -- Tokens únicos y no vacíos.
  v_tokens := array(
    select distinct x from unnest(coalesce(p_tokens, '{}')) x
     where x is not null and btrim(x) <> ''
  );
  if array_length(v_tokens, 1) is null then
    return;  -- nadie con token: no hay nada que mandar
  end if;

  select jsonb_agg(jsonb_build_object(
           'to', t,
           'sound', 'default',
           'title', p_titulo,
           'body', left(coalesce(p_cuerpo, ''), 500),
           'data', coalesce(p_datos, '{}'::jsonb),
           'channelId', 'recorrido',
           'priority', 'high'
         ))
    into v_body
    from unnest(v_tokens) t;

  -- Async (se encola y se manda tras el commit; si la transacción se revierte,
  -- el pedido se revierte con ella y no se manda un aviso falso).
  perform net.http_post(
    url := 'https://exp.host/--/api/v2/push/send',
    body := v_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Accept', 'application/json')
  );
end;
$$;

comment on function interno.notificar_push(text[], text, text, jsonb) is
  'Manda un push de Expo (canal recorrido) a una lista de tokens. Best-effort, async por pg_net.';


-- ── Aviso de STOCK AGOTADO a todos los vendedores ───────────────────────────
create or replace function interno.avisar_vendedores_agotado(p_codigo text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'interno', 'pg_temp'
as $$
declare
  v_nombre text;
  v_tokens text[];
begin
  select descripcion into v_nombre
    from public.vista_catalogo_vigente
   where codigo = p_codigo and es_servicio = false
   limit 1;

  select array_agg(distinct d.push_token) into v_tokens
    from public.dispositivos d
    join public.perfiles p on p.id = d.perfil_id
   where p.rol = 'vendedor'
     and d.autorizado
     and d.push_token is not null;

  perform interno.notificar_push(
    v_tokens,
    'Stock agotado',
    coalesce(nullif(btrim(v_nombre), ''), p_codigo) || ' se quedó sin stock.',
    jsonb_build_object('tipo', 'stock_agotado', 'codigo', p_codigo)
  );
end;
$$;


-- ── descontar_stock: avisa cuando una VENTA deja el producto en 0 ───────────
-- Igual que antes + el aviso best-effort. El resto del cuerpo no cambia.
create or replace function interno.descontar_stock(p_codigo text, p_cantidad integer)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'interno', 'pg_temp'
as $function$
declare
  v_actual int;
  v_bajado int;
begin
  if p_codigo is null or coalesce(p_cantidad, 0) <= 0 then
    return 0;
  end if;
  select cantidad into v_actual
    from public.stock_articulos
   where codigo = p_codigo
   for update;
  if not found then
    return 0;  -- producto no trackeado: no se inventan filas
  end if;
  v_bajado := least(p_cantidad, greatest(v_actual, 0));
  update public.stock_articulos
     set cantidad        = v_actual - v_bajado,
         actualizado_en  = now(),
         actualizado_por = auth.uid()
   where codigo = p_codigo;

  -- La venta dejó el producto en 0: avisar a los vendedores. Best-effort —un
  -- fallo del push no puede voltear la venta—.
  if v_actual > 0 and (v_actual - v_bajado) = 0 then
    begin
      perform interno.avisar_vendedores_agotado(p_codigo);
    exception when others then
      null;
    end;
  end if;

  return v_bajado;
end;
$function$;


-- ── Aviso al vendedor cuando le RESPONDEN el reporte ────────────────────────
create or replace function interno.avisar_reporte_respondido_push()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'interno', 'pg_temp'
as $$
declare
  v_tokens text[];
begin
  -- Sólo al aparecer la PRIMERA respuesta (de vacío a con texto): editar una
  -- respuesta ya puesta no vuelve a avisar.
  if coalesce(btrim(old.respuesta), '') <> '' then return new; end if;
  if coalesce(btrim(new.respuesta), '') = '' then return new; end if;
  if new.vendedor_id is null then return new; end if;

  select array_agg(distinct d.push_token) into v_tokens
    from public.dispositivos d
   where d.perfil_id = new.vendedor_id
     and d.autorizado
     and d.push_token is not null;

  begin
    perform interno.notificar_push(
      v_tokens,
      'Respondieron tu reporte',
      new.respuesta,
      jsonb_build_object('tipo', 'reporte_respondido', 'reporteId', new.id)
    );
  exception when others then
    null;  -- un fallo del aviso no puede voltear la respuesta de la oficina
  end;

  return new;
end;
$$;

drop trigger if exists reportes_problema_avisar_respuesta on public.reportes_problema;
create trigger reportes_problema_avisar_respuesta
  after update on public.reportes_problema
  for each row execute function interno.avisar_reporte_respondido_push();
