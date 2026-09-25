-- Estas policies chequeaban solo "dueño" (vendedor_id = auth.uid()) sin
-- esta_habilitado(), asi que un usuario suspendido/baja con JWT vivo podia leer
-- su propia data (y editar renglones de sus notas pendientes). Se agrega el gate
-- de esta_habilitado() a la rama de dueño. Un habilitado pasa igual; solo el
-- suspendido pierde el acceso. No afecta a puede_ver_todo() (supervisores/admin).
-- Verificado (mismo vendedor): habilitado ve 162 notas / 250 items / 902 pos;
-- suspendido ve 0 en las tres.

alter policy notas_leer on public.notas_pedido
  using (interno.puede_ver_todo() or (vendedor_id = auth.uid() and interno.esta_habilitado()));

alter policy items_leer on public.notas_pedido_items
  using (
    interno.puede_ver_todo()
    or (interno.esta_habilitado() and exists (
      select 1 from public.notas_pedido n
       where n.id = notas_pedido_items.nota_id and n.vendedor_id = auth.uid()))
  );

alter policy items_escribir_propios on public.notas_pedido_items
  using (
    interno.esta_habilitado() and exists (
      select 1 from public.notas_pedido n
       where n.id = notas_pedido_items.nota_id
         and n.vendedor_id = auth.uid()
         and n.estado = any (array['pendiente'::estado_nota_pedido, 'pendiente_cliente'::estado_nota_pedido]))
  )
  with check (
    interno.esta_habilitado() and exists (
      select 1 from public.notas_pedido n
       where n.id = notas_pedido_items.nota_id and n.vendedor_id = auth.uid())
  );

alter policy posiciones_leer on public.posiciones
  using (interno.puede_ver_todo() or (vendedor_id = auth.uid() and interno.esta_habilitado()));

alter policy presencias_propias_leer on public.presencias
  using (interno.puede_ver_todo() or (vendedor_id = auth.uid() and interno.esta_habilitado()));

alter policy reportes_problema_leer on public.reportes_problema
  using (interno.puede_ver_todo() or (vendedor_id = auth.uid() and interno.esta_habilitado()));

alter policy paradas_leer on public.paradas
  using (
    interno.puede_ver_todo()
    or (interno.esta_habilitado() and exists (
      select 1 from public.roles_visita rv
       where rv.id = paradas.rol_visita_id and rv.vendedor_id = auth.uid()))
  );
