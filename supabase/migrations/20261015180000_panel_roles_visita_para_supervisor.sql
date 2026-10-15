-- El supervisor tambien puede abrir "Roles de visita" en el panel (antes era
-- admin-only). Ve los recorridos de todos los vendedores en modo lectura; la RLS
-- le impide ver los de un admin (ver 20261015160000 / 20261015170000). El admin
-- ya la veia por ser admin.
update public.funciones
   set roles_habilitados = array['supervisor']::rol_usuario[]
 where clave = 'panel_roles_visita'
   and roles_habilitados = '{}'::rol_usuario[];
