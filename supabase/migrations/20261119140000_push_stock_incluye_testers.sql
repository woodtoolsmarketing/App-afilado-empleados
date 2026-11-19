-- El aviso de stock agotado debe llegar también a los TESTER: un tester es un
-- vendedor que además saca capturas (ver memoria rol-tester), trabaja en la
-- calle igual. La primera versión (20261119130000) filtraba sólo rol='vendedor'
-- y dejaba afuera, p.ej., a Nicolas Saad, que trabaja en una cuenta tester.
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
   where p.rol in ('vendedor', 'tester')
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
