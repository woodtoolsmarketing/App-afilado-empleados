-- Elegir la impresora activa de la oficina desde el panel.
--
-- Escribir `configuracion` es solo-admin por RLS, pero quien imprime en la
-- oficina es administracion. Esta funcion (SECURITY DEFINER) deja elegir a admin
-- Y administracion, y solo entre las IPs del catalogo curado
-- (`configuracion.impresoras`): no se puede cargar una direccion arbitraria por
-- este camino. La elegida se copia a `configuracion.impresora_oficina`, que es la
-- fila que leen el panel (cola, roles, cobranzas) y la app del telefono.
--
-- El catalogo `configuracion.impresoras` y la impresora activa se cargan como
-- datos (no en esta migracion), igual que la fila `impresora_oficina` original.
create or replace function public.elegir_impresora(p_ip text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_elegida jsonb;
begin
  if not interno.es_administracion() then
    raise exception 'No tenes permiso para cambiar la impresora.' using errcode = '42501';
  end if;

  -- La IP tiene que estar en el catalogo: nada de direcciones a mano por aca.
  select item into v_elegida
  from public.configuracion c,
       lateral jsonb_array_elements(c.valor) as t(item)
  where c.clave = 'impresoras'
    and item->>'ip' = p_ip
  limit 1;

  if v_elegida is null then
    raise exception 'Esa impresora no esta en la lista cargada.' using errcode = 'P0002';
  end if;

  update public.configuracion
  set valor = v_elegida,
      actualizado_por = auth.uid(),
      actualizado_en = now()
  where clave = 'impresora_oficina';

  -- Si por algun motivo no existia la fila activa, se crea.
  if not found then
    insert into public.configuracion (clave, valor, actualizado_por)
    values ('impresora_oficina', v_elegida, auth.uid());
  end if;

  return v_elegida;
end;
$$;

revoke all on function public.elegir_impresora(text) from public, anon;
grant execute on function public.elegir_impresora(text) to authenticated;
