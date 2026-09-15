-- =============================================================================
-- Pedidos de restablecer contraseña
--
-- El que se olvidó la contraseña NO tiene sesión, y Supabase exige estar
-- logueado para cambiarla. Así que el circuito no puede ser un permiso pasivo:
-- tiene que haber una fila que alguien de la oficina habilita a mano y que
-- después una función con clave de servicio usa para poner la nueva.
--
-- El flujo, y por qué cada estado:
--
--   pendiente   El vendedor tocó "Olvidé mi contraseña". La oficina lo tiene
--               que ver y habilitar. Nadie puede cambiar nada todavía.
--   habilitado  Un administrador lo permitió. Recién ahora el vendedor puede
--               elegir su clave nueva, y sólo hasta que venza (`vence_en`).
--   usada       El vendedor ya puso su contraseña. Queda para que la oficina
--               vea que el círculo se cerró.
--   cancelada   Un pedido viejo que se reemplazó por uno nuevo (o que el
--               vendedor descartó). No sirve para nada.
--
-- No se guarda ninguna contraseña acá, ni en ningún lado: la nueva la escribe
-- el vendedor y viaja directo a Auth. Lo único que se guarda es el HASH de un
-- token de un solo uso —`token_hash`— que la función de pedir le devuelve al
-- teléfono. Completar el cambio exige presentar ese token: que un tercero vea
-- que el pedido quedó "habilitado" no le alcanza, porque el token lo tiene sólo
-- el aparato que pidió.
-- =============================================================================

create table if not exists public.pedidos_contrasena (
  id            uuid primary key default extensions.gen_random_uuid(),
  perfil_id     uuid not null references public.perfiles (id) on delete cascade,
  -- Desnormalizado a propósito: el panel lista pedidos sin tener que cruzar con
  -- perfiles, y si el usuario se renombrara después, la fila sigue diciendo con
  -- qué nombre se pidió.
  usuario       text not null,

  estado        text not null default 'pendiente'
                check (estado in ('pendiente', 'habilitado', 'usada', 'cancelada')),

  -- De dónde salió el pedido, que cambia cómo se ata. El celular tiene un
  -- identificador de instalación estable; el panel no, así que ahí el único
  -- amarre es el token más el vencimiento.
  origen        text not null default 'celular'
                check (origen in ('celular', 'panel')),

  -- El `instalacion_id` del teléfono que pidió (null cuando vino del panel).
  -- Completar desde el celular exige que coincida: aunque se filtre el token,
  -- tiene que ser el mismo aparato.
  dispositivo_id   text,
  -- "Samsung SM-A processing" y demás, para que la oficina sepa a quién le está
  -- habilitando el cambio antes de tocar el botón.
  dispositivo_desc text,

  -- SHA-256 del token de un solo uso. El token en claro no queda: se le devolvió
  -- una vez al que pidió y no se puede recuperar de acá.
  token_hash    text not null,

  habilitado_por uuid references public.perfiles (id) on delete set null,
  habilitado_en  timestamptz,
  -- Hasta cuándo vale la habilitación. Un permiso para cambiar la clave que no
  -- vence es un permiso que queda abierto para siempre si el vendedor nunca lo
  -- usa.
  vence_en       timestamptz,

  usada_en       timestamptz,
  creado_en      timestamptz not null default now()
);

comment on table public.pedidos_contrasena is
  'Pedidos de restablecer contrasena. El vendedor pide sin sesion, un admin habilita, y una funcion con clave de servicio pone la clave nueva. No guarda contrasenas, solo el hash de un token de un solo uso.';

-- El globo del panel cuenta los pendientes; la búsqueda de un pedido activo por
-- perfil (para no apilar duplicados) filtra por perfil y estado.
create index if not exists pedidos_contrasena_estado
  on public.pedidos_contrasena (estado, creado_en desc);
create index if not exists pedidos_contrasena_perfil
  on public.pedidos_contrasena (perfil_id, estado);

alter table public.pedidos_contrasena enable row level security;

-- Leer: la oficina (admin o supervisor), igual que ve los teléfonos por
-- habilitar. El vendedor NO lee esta tabla: cuando pide y cuando completa no
-- tiene sesión, así que esos dos pasos van por función con clave de servicio,
-- que saltea RLS. Un cliente anónimo nunca toca esta tabla directamente.
drop policy if exists pedidos_contrasena_leer on public.pedidos_contrasena;
create policy pedidos_contrasena_leer on public.pedidos_contrasena
  for select to authenticated
  using (interno.puede_ver_todo());

-- Habilitar (y cualquier otra corrección): sólo un administrador. Es el mismo
-- candado que aprobar un alta o habilitar un teléfono.
drop policy if exists pedidos_contrasena_admin on public.pedidos_contrasena;
create policy pedidos_contrasena_admin on public.pedidos_contrasena
  for all to authenticated
  using (interno.es_admin())
  with check (interno.es_admin());
