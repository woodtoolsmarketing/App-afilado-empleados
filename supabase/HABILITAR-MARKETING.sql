-- =============================================================================
-- WoodTools · habilitar marketing@woodtools.com.ar como administrador
--
-- CORRER DESPUÉS de crear el usuario en el Dashboard
-- (Authentication → Users → Add user), donde la contraseña la escribís vos.
--
-- El trigger `al_crear_usuario` le arma el perfil solo, pero como 'vendedor' y
-- 'pendiente': así entra todo el mundo, y un administrador decide después. Esto
-- hace esa decisión.
-- =============================================================================

-- ── 1 · Volverlo administrador y aprobarle el acceso ────────────────────────
--
-- `aprobado_en` no es decorativo: hay un CHECK que impide dejar un perfil en
-- 'aprobado' sin fecha de aprobación.
--
-- No se le pone `codigo_vendedor` porque no sale a la calle. El CHECK
-- `perfiles_vendedor_necesita_codigo` sólo exige código a los de rol 'vendedor'.
update public.perfiles
   set rol         = 'admin',
       estado      = 'aprobado',
       aprobado_en = now()
 where email = 'marketing@woodtools.com.ar';

-- Si esto devuelve 0 filas, el usuario todavía no existe en Authentication.
select id, email, nombre_completo, rol, estado, aprobado_en
  from public.perfiles
 where email = 'marketing@woodtools.com.ar';


-- ── 2 · Autorizar el dispositivo ────────────────────────────────────────────
--
-- CORRER RECIÉN DESPUÉS de intentar entrar una vez desde el probador o desde el
-- teléfono: el dispositivo se registra en ese primer intento, y hasta que no
-- exista no hay nada que autorizar.
--
-- Es el tercer candado del sistema. Se puede hacer desde el panel → Usuarios;
-- esto es el atajo por SQL.
update public.dispositivos
   set autorizado    = true,
       autorizado_en = now(),
       autorizado_por = perfil_id
 where perfil_id = (select id from public.perfiles where email = 'marketing@woodtools.com.ar');

select modelo, version_so, autorizado, ultimo_visto_en
  from public.dispositivos
 where perfil_id = (select id from public.perfiles where email = 'marketing@woodtools.com.ar');
