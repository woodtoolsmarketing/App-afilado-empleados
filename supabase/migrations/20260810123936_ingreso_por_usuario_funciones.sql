-- =============================================================================
-- Las funciones que usan `perfiles.usuario` y `perfiles.zonas`
-- =============================================================================

-- El alta ya trae el usuario: sin esto, el primero que se registre después de
-- la migración anterior queda con la columna vacía y no puede entrar por nombre.
create or replace function public.manejar_nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  insert into public.perfiles (id, email, usuario, nombre_completo, codigo_vendedor, rol, estado)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(lower(trim(new.raw_user_meta_data ->> 'usuario')), ''),
      lower(split_part(new.email, '@', 1))
    ),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'nombre_completo'), ''), split_part(new.email, '@', 1)),
    nullif(trim(new.raw_user_meta_data ->> 'codigo_vendedor'), ''),
    'vendedor',
    'pendiente'
  )
  on conflict (id) do nothing;

  return new;
end;
$function$;


-- ─────────────────────────────────────────────────────────────────────────────
-- Con qué correo hay que autenticar a alguien que escribió "asosa".
--
-- Supabase Auth entra por email y nada más, así que la traducción tiene que
-- pasar ANTES del login — y por lo tanto sin sesión. De ahí el `security
-- definer` y el permiso a `anon`.
--
-- Qué expone: confirma si un usuario existe y devuelve su correo. En una app
-- abierta al público eso sería un padrón regalado; acá el padrón son los
-- empleados de la empresa, el correo es institucional, y la alternativa es que
-- el nombre de usuario no sirva para entrar. Las cuentas rechazadas o dadas de
-- baja quedan afuera: no tienen por qué seguir apareciendo.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.email_para_ingreso(identificador text)
returns text
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $function$
  select u.email
    from public.perfiles p
    join auth.users u on u.id = p.id
   where p.estado in ('pendiente', 'aprobado')
     and (
       lower(p.usuario) = lower(trim(identificador))
       or lower(p.email) = lower(trim(identificador))
     )
   limit 1
$function$;

comment on function public.email_para_ingreso(text) is 'Traduce nombre de usuario a correo para el login. Devuelve null si no hay ninguno.';

revoke all on function public.email_para_ingreso(text) from public;
grant execute on function public.email_para_ingreso(text) to anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- Qué vendedor corresponde a una zona.
--
-- Devuelve null cuando la zona no está asignada **y también cuando está
-- asignada a más de uno**. Es la misma decisión que toma la asignación
-- automática de zona por localidad: entre poner un número que nadie miró en un
-- comprobante y dejar el campo vacío para que alguien lo complete, lo segundo
-- se arregla; lo primero se factura.
--
-- Va con `security definer` porque un vendedor no puede leer el perfil de otro
-- —y no hace falta que pueda: de acá sale un número, no una ficha.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.vendedor_de_zona(codigo text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select case when count(*) = 1 then min(v.codigo_vendedor) end
    from (
      select distinct p.codigo_vendedor
        from public.perfiles p
       where p.estado = 'aprobado'
         and p.codigo_vendedor is not null
         and trim(codigo) <> ''
         and trim(codigo) = any (p.zonas)
    ) v
$function$;

comment on function public.vendedor_de_zona(text) is 'Codigo de vendedor a cargo de una zona. Null si no hay ninguno o si hay mas de uno.';

revoke all on function public.vendedor_de_zona(text) from public;
grant execute on function public.vendedor_de_zona(text) to authenticated;
