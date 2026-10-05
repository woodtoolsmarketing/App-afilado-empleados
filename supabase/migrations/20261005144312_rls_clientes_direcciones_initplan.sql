-- RLS de clientes y direcciones: evaluar las funciones de sesión UNA vez, no por fila.
--
-- ─── El problema ─────────────────────────────────────────────────────────────
--
-- Las policies de `clientes` y `direcciones` llamaban a interno.es_admin() /
-- puede_ver_todo() / esta_habilitado() DIRECTO. Esas funciones son STABLE y
-- dependen sólo de quién pregunta (auth.uid()), no de la fila —pero escritas así,
-- Postgres las vuelve a ejecutar UNA VEZ POR FILA en cualquier escaneo. Sobre las
-- 16.600 fichas de `clientes` (y las ~9.500 de `direcciones`) eso son decenas de
-- miles de consultas a `perfiles` por cada SELECT.
--
-- Medido como admin: `select count(*) from clientes` tardaba 5,5 s. El listado del
-- panel (clientes + direcciones anidadas, que es lo que abre la pantalla Clientes)
-- tardaba 6-7 s. Y mientras una de esas consultas corre, SATURA la base: cualquier
-- otra operación —agregar un destino al recorrido, por ejemplo— se queda esperando
-- y revienta su `statement_timeout` de 8 s con "canceling statement due to statement
-- timeout". El timeout del vendedor al agregar un cliente no era un bug de ese
-- camino (que tarda ~6 ms): era la base ahogada por estas consultas lentas.
--
-- Es el mismo defecto que tenía `buscar_clientes` (ver
-- 20261005132945_buscar_clientes_security_definer_gate), acá en las policies.
--
-- ─── El arreglo ──────────────────────────────────────────────────────────────
--
-- Envolver cada función de sesión en una subconsulta escalar: `(select f())`.
-- Postgres la trata como InitPlan —la ejecuta UNA vez por consulta— en vez de por
-- fila. Es exactamente lo que recomienda Supabase para RLS, y no cambia NADA de lo
-- que cada quien ve: la función devuelve el mismo valor para todas las filas porque
-- no mira la fila. Verificado antes de aplicar, misma visibilidad fila por fila:
--   · admin:        16.603 clientes (igual)         · count: 5522 ms → 9 ms
--   · vendedor #15:  16.603 clientes / 9.982 direcciones (igual)
--   · autenticado no habilitado: 0 (igual)   · anon: sin grant (sigue sin acceso)
--   · listado del panel (200 + direcciones): 6-7 s → 605 ms
--
-- Sólo se tocan las policies de LECTURA/ALL (las que escanean muchas filas). Las de
-- escritura (clientes_crear_en_ruta, direcciones_crear, direcciones_corregir) gatean
-- de a una fila al escribir, así que su costo por fila es irrelevante y no se tocan.

-- ── clientes ─────────────────────────────────────────────────────────────────
drop policy if exists clientes_admin on public.clientes;
create policy clientes_admin on public.clientes
  for all
  using ((select interno.es_admin()))
  with check ((select interno.es_admin()));

drop policy if exists clientes_leer on public.clientes;
create policy clientes_leer on public.clientes
  for select
  using (
    (select interno.puede_ver_todo())
    or ((select interno.esta_habilitado()) and activo)
    or ((select interno.esta_habilitado()) and exists (
         select 1
           from public.paradas pa
           join public.roles_visita rv on rv.id = pa.rol_visita_id
          where pa.cliente_id = clientes.id
            and rv.vendedor_id = (select auth.uid())))
  );

-- ── direcciones ──────────────────────────────────────────────────────────────
drop policy if exists direcciones_admin on public.direcciones;
create policy direcciones_admin on public.direcciones
  for all
  using ((select interno.es_admin()))
  with check ((select interno.es_admin()));

drop policy if exists direcciones_leer on public.direcciones;
create policy direcciones_leer on public.direcciones
  for select
  using (
    (select interno.puede_ver_todo())
    or ((select interno.esta_habilitado()) and ((cliente_id is null) or exists (
         select 1 from public.clientes c where c.id = direcciones.cliente_id)))
  );

-- ── Índice para el ORDER BY del listado del panel ────────────────────────────
-- La pantalla Clientes trae 200 fichas ordenadas por razón social. Sin índice eso
-- era un seq scan + ordenamiento de las 16.600 filas (~265 ms del medio segundo que
-- quedó). Con el índice, el listado baja a decenas de ms.
create index if not exists clientes_razon_social_idx
  on public.clientes (razon_social);
