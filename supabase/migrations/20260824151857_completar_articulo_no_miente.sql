-- `completar_articulo` escribía cero filas, no avisaba, y auditaba el cambio.
--
-- La función es SECURITY INVOKER y su guardia interna es
-- `interno.es_administracion()`, que acepta DOS roles: 'administracion' y
-- 'admin'. La única policy de escritura sobre `catalogo_articulos` es
-- `catalogo_admin`, que exige `interno.es_admin()` — o sea, 'admin' a secas.
--
-- Un usuario con rol 'administracion' pasa la guardia y lo frena RLS. Y RLS no
-- frena con un error: filtra. El UPDATE afecta cero filas, `returning * into
-- fila` deja `fila` en NULL, nadie lo mira, y PostgREST convierte ese composite
-- NULL en una fila de columnas nulas con `error: null`. El panel lo lee como
-- éxito y le dice a Administración que el precio quedó cargado.
--
-- Es el tercer caso del mismo patrón en este proyecto: ya pasó con
-- `ubicar_cliente` —donde tuvo al rol de visita sin registrar una sola visita
-- desde el día uno— y con `registrar_visita`. Acá todavía no mordió sólo
-- porque hoy no hay ningún perfil con rol 'administracion': son 3 admin y 1
-- vendedor. Es una trampa armada esperando al primer usuario de ese rol.
--
-- Y lo peor no es que no guarde: es que igual escribe en `auditoria` que se
-- completó el precio. Queda asentado un cambio que nunca ocurrió.
--
-- Se arregla por los dos lados:
--
--  · SECURITY DEFINER, para que la autoridad sea la guardia de la función —que
--    es la que expresa la regla del negocio, "sólo el Dpto. de Administración"—
--    y no una policy que dice otra cosa. Es lo mismo que ya hacen `fichar` y
--    `ubicacion_de_nota`.
--  · Un control después del UPDATE. Aunque hoy el DEFINER lo vuelva
--    innecesario, cero filas no puede volver a leerse como éxito nunca más: si
--    no actualizó, revienta con 42501 ANTES de auditar.

create or replace function public.completar_articulo(
  p_codigo text,
  p_precio numeric,
  p_moneda text
) returns public.catalogo_articulos
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  objetivo uuid;
  fila     public.catalogo_articulos;
begin
  if not interno.es_administracion() then
    raise exception 'Solo el Dpto. de Administracion puede completar precios del catalogo'
      using errcode = '42501';
  end if;

  if p_moneda not in ('ARS', 'USD') then
    raise exception 'La moneda tiene que ser ARS o USD' using errcode = '23514';
  end if;

  if p_precio is null or p_precio <= 0 then
    raise exception 'El precio tiene que ser mayor a cero' using errcode = '23514';
  end if;

  -- La edicion vigente del codigo: la de la lista mas nueva.
  select id into objetivo
    from public.catalogo_articulos
   where codigo = p_codigo
   order by lista_fecha desc, creado_en desc
   limit 1;

  if objetivo is null then
    raise exception 'No existe el articulo %', p_codigo using errcode = 'P0002';
  end if;

  update public.catalogo_articulos
     set precio = p_precio, moneda = p_moneda
   where id = objetivo
  returning * into fila;

  -- Cero filas actualizadas no es un exito silencioso. Va ANTES de auditar:
  -- una auditoria de algo que no paso es peor que no tener auditoria.
  if fila.id is null then
    raise exception 'No se pudo completar el articulo %', p_codigo using errcode = '42501';
  end if;

  insert into public.auditoria (actor_id, accion, entidad, entidad_id, datos)
  values (auth.uid(), 'catalogo.precio_completado', 'catalogo_articulos', p_codigo,
          jsonb_build_object('precio', p_precio, 'moneda', p_moneda));

  return fila;
end;
$$;

comment on function public.completar_articulo(text, numeric, text) is
  'Completa precio y moneda de un articulo a cotizar. SECURITY DEFINER: la regla '
  'es la guardia interna es_administracion(), no la policy de la tabla, que solo '
  'admite es_admin(). Revienta si el update no toca ninguna fila.';
