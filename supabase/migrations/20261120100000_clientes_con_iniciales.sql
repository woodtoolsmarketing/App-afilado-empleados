-- Lista para el panel: clientes cuya CALLE (texto del padrón en clientes.direccion)
-- está escrita con iniciales en vez de nombres — "H.YRIGOYEN", "J.B.ALBERDI",
-- "M.LEGUIZAMON", "A. PALACIOS" — para que la oficina las corrija a mano.
--
-- El regex toma una letra sola seguida de punto y de un apellido (otra mayúscula),
-- al principio o después de un no-letra: así "AV." (Avenida, dos letras) NO entra,
-- y "D.20" / "P4" (punto seguido de número) tampoco. Devuelve el cliente con sus
-- direcciones embebidas (misma forma que `select *, direcciones(*)`), gateado a
-- quien puede ver todo (oficina/admin): a un vendedor le devuelve [].
create or replace function public.clientes_con_iniciales(p_limite integer default 500)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(jsonb_agg(fila order by fila->>'razon_social'), '[]'::jsonb)
  from (
    select to_jsonb(c) || jsonb_build_object(
      'direcciones',
      coalesce(
        (select jsonb_agg(to_jsonb(d)) from public.direcciones d where d.cliente_id = c.id),
        '[]'::jsonb)
    ) as fila
    from public.clientes c
    where (select interno.puede_ver_todo())
      and c.activo
      and coalesce(c.direccion, '') ~ '(^|[^[:alpha:]])[A-ZÑÁÉÍÓÚ][.][[:space:]]?[A-ZÑÁÉÍÓÚ]'
    order by c.razon_social
    limit greatest(1, least(coalesce(p_limite, 500), 2000))
  ) t;
$function$;

revoke all on function public.clientes_con_iniciales(integer) from public, anon;
grant execute on function public.clientes_con_iniciales(integer) to authenticated;
