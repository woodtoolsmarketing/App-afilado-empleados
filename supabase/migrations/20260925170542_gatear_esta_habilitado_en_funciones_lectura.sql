-- Estas 4 funciones SECURITY DEFINER de lectura no tenian el gate de
-- interno.esta_habilitado() que si tienen todas las de escritura. Un usuario
-- autenticado pero no aprobado (pendiente/rechazado/suspendido/baja) con JWT
-- todavia valido podia leer el padron con coordenadas y fichas de clientes.
-- Se agrega el gate inline: al no-autorizado le devuelve vacio (mismo criterio
-- que RLS), no error. Todas se llaman solo desde pantallas post-login de
-- usuarios aprobados, asi que no cambia nada para los legitimos.

create or replace function public.clientes_en_mapa()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select case when interno.esta_habilitado() then (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'codigo', t.codigo,
          'razon_social', t.razon_social,
          'lat', t.lat,
          'lng', t.lng
        )
      ),
      '[]'::jsonb
    )
    from (
      select distinct on (c.id)
        c.id, c.codigo, c.razon_social, d.lat, d.lng
      from public.clientes c
      join public.direcciones d on d.cliente_id = c.id
      where c.activo
        and d.lat is not null
        and d.lng is not null
      order by c.id, d.principal desc, d.creado_en
    ) t
  ) else '[]'::jsonb end;
$function$;

create or replace function public.ficha_cliente(p_cliente_id uuid)
 returns table(razon_social text, nombre_fantasia text, direccion_id uuid, direccion_formateada text)
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select c.razon_social, c.nombre_fantasia, d.id, d.direccion_formateada
    from public.clientes c
    left join lateral (
      select id, direccion_formateada
        from public.direcciones
       where cliente_id = c.id
       order by principal desc, creado_en
       limit 1
    ) d on true
   where c.id = p_cliente_id
     and interno.esta_habilitado();
$function$;

create or replace function public.vendedor_de_zona(codigo text)
 returns text
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select case when interno.esta_habilitado() then (
    select case when count(*) = 1 then min(v.codigo_vendedor) end
      from (
        select distinct p.codigo_vendedor
          from public.perfiles p
         where p.estado = 'aprobado'
           and p.codigo_vendedor is not null
           and trim(codigo) <> ''
           and trim(codigo) = any (p.zonas)
      ) v
  ) end;
$function$;

create or replace function public.cuando_se_da_frecuente(p_motivo text default null::text, p_limite integer default 8)
 returns table(texto text, veces bigint)
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  with dichas as (
    select
      btrim(r.cuando_se_da) as frase,
      lower(translate(btrim(r.cuando_se_da),
                      'áéíóúüñÁÉÍÓÚÜÑ',
                      'aeiouunAEIOUUN')) as clave
    from public.reportes_problema r
    where r.cuando_se_da is not null
      and length(btrim(r.cuando_se_da)) between 3 and 120
      and (p_motivo is null or r.motivo = p_motivo)
  ),
  agrupadas as (
    select
      d.clave,
      count(*) as repeticiones,
      (array_agg(d.frase order by d.frase))[1] as frase
    from dichas d
    group by d.clave
  )
  select a.frase, a.repeticiones
    from agrupadas a
   where a.repeticiones >= 2
     and interno.esta_habilitado()
   order by a.repeticiones desc, a.frase
   limit least(coalesce(p_limite, 8), 30);
$function$;
