-- =============================================================================
-- "Lugares de entrega a cargar": sección del panel para que la oficina complete
-- a mano (pin en el mapa) los lugares de entrega importados del Gestión que
-- quedaron en estado 'crudo' (dirección incompleta), o los descarte si el texto
-- no era una dirección sino una nota/teléfono.
--
-- La escritura va por RPC SECURITY DEFINER (no update directo) por lo mismo que
-- confirmar_cliente_provisorio/aplicar_cambio_direccion: así administración
-- también puede, sin abrirle la RLS de `direcciones`/`lugares_entrega_import`
-- (cuyo for-all es sólo es_admin). El chequeo de permiso va adentro.
-- =============================================================================

-- ── 1) La sección del panel (arranca admin-only: roles_habilitados vacío) ──
insert into public.funciones (clave, etiqueta, descripcion, orden, roles_habilitados, ambito)
select
  'panel_lugares_entrega_cargar',
  'Lugares de entrega a cargar',
  'Direcciones de entrega del Gestión que quedaron sin ubicar: marcá el punto en el mapa o descartalas',
  112,
  array[]::public.rol_usuario[],
  'panel'
where not exists (select 1 from public.funciones where clave = 'panel_lugares_entrega_cargar');

-- ── 2) Cargar un lugar de entrega: crea la dirección (non-principal) y marca
--       la fila staging como geocodificada, atómicamente. ──
create or replace function public.cargar_lugar_entrega_import(
  p_import_id            uuid,
  p_etiqueta             text,
  p_direccion_formateada text,
  p_lat                  double precision,
  p_lng                  double precision,
  p_codigo_postal        text default null,
  p_google_place_id      text default null
)
 returns public.direcciones
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare
  imp public.lugares_entrega_import;
  d   public.direcciones;
begin
  if not interno.es_administracion() then
    raise exception 'Sólo administración o un administrador puede cargar lugares de entrega.' using errcode = '42501';
  end if;

  -- Bloquea la fila para que dos cargas simultáneas no creen dos direcciones.
  select * into imp from public.lugares_entrega_import where id = p_import_id for update;
  if imp.id is null then
    raise exception 'No existe ese registro de lugar de entrega.' using errcode = 'P0002';
  end if;
  if imp.estado <> 'crudo' then
    raise exception 'Ese registro ya fue resuelto.' using errcode = '23514';
  end if;
  if imp.cliente_id is null then
    raise exception 'Ese registro no está asociado a ningún cliente.' using errcode = '23514';
  end if;
  if p_lat is null or p_lng is null then
    raise exception 'Falta marcar el punto en el mapa.' using errcode = '23514';
  end if;
  if coalesce(btrim(p_direccion_formateada), '') = '' then
    raise exception 'Falta la dirección.' using errcode = '23514';
  end if;

  insert into public.direcciones
    (cliente_id, etiqueta, direccion_formateada, codigo_postal, lat, lng,
     google_place_id, principal, verificada, observaciones)
  values
    (imp.cliente_id,
     coalesce(nullif(btrim(p_etiqueta), ''), 'Entrega'),
     btrim(p_direccion_formateada),
     nullif(btrim(p_codigo_postal), ''),
     p_lat, p_lng, p_google_place_id,
     false, true,
     'Importado del Gestión (cargado a mano desde el panel).')
  returning * into d;

  update public.lugares_entrega_import
     set estado = 'geocodificado', direccion_id = d.id
   where id = p_import_id;

  return d;
end;
$$;

-- ── 3) Descartar: el texto no era una dirección (nota/teléfono/zona sin altura). ──
create or replace function public.descartar_lugar_entrega_import(p_import_id uuid)
 returns public.lugares_entrega_import
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare fila public.lugares_entrega_import;
begin
  if not interno.es_administracion() then
    raise exception 'Sólo administración o un administrador puede descartar lugares de entrega.' using errcode = '42501';
  end if;
  update public.lugares_entrega_import
     set estado = 'descartado'
   where id = p_import_id and estado = 'crudo'
  returning * into fila;
  if fila.id is null then
    raise exception 'Ese registro no existe o ya fue resuelto.' using errcode = 'P0002';
  end if;
  return fila;
end;
$$;

-- `create or replace` deja el ACL en PUBLIC EXECUTE: hay que volver a cerrarlo
-- (mismo endurecimiento que aplicar_cambio_direccion). El chequeo interno igual gatea.
revoke all on function public.cargar_lugar_entrega_import(uuid, text, text, double precision, double precision, text, text) from public;
revoke all on function public.cargar_lugar_entrega_import(uuid, text, text, double precision, double precision, text, text) from anon;
grant execute on function public.cargar_lugar_entrega_import(uuid, text, text, double precision, double precision, text, text) to authenticated;
revoke all on function public.descartar_lugar_entrega_import(uuid) from public;
revoke all on function public.descartar_lugar_entrega_import(uuid) from anon;
grant execute on function public.descartar_lugar_entrega_import(uuid) to authenticated;
