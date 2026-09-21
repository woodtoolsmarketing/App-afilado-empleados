import type { Cliente, Perfil } from '@woodtools/compartido'
import { espaciado, radios, TOQUE_MINIMO } from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'

import { BotonMenu, BotonPrincipal, BotonSecundario } from '../../componentes/Botones'
import { Campo, Desplegable, MensajeError } from '../../componentes/Formulario'
import { Aviso, Cargando, Pastilla, Vacio } from '../../componentes/Estado'
import { Encabezado } from '../../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../../componentes/Pantalla'
import {
  alternarActivoCliente,
  buscarClientesCartera,
  clientesProvisorios,
  contarClientes,
  guardarCliente,
  vendedoresAsignables,
  type ClienteConDirecciones,
  type DatosCliente,
  type DatosDireccionPrincipal,
} from '../../servicios/administracion'
import type { PropsPantalla } from '../../navegacion/tipos'
import { hojaDeTema, usarTema } from '../../nucleo/tema'

/**
 * "CLIENTES" — el ABM de la cartera, en el teléfono.
 *
 * Es la misma gestión que hace el panel de escritorio: el encabezado con el
 * total, el aviso de los que un vendedor cargó desde la calle y todavía no
 * tienen código real, el buscador que consulta al servidor —la cartera son más
 * de dieciséis mil clientes, no entra en memoria— y la ficha completa en un
 * formulario para dar de alta, editar, o dar de baja y reactivar.
 *
 * A diferencia del panel, la tabla es una lista de tarjetas y la ficha se abre
 * en una hoja modal casi a pantalla completa: en un teléfono una fila con siete
 * columnas no se lee, y un formulario con doce campos necesita su propio lugar.
 */

type Vendedor = Pick<Perfil, 'id' | 'nombre_completo' | 'codigo_vendedor'>

export function PantallaClientes({ navigation }: PropsPantalla<'AdminClientes'>) {
  const estilos = usarEstilos()
  const { colores } = usarTema()
  const qc = useQueryClient()

  const [busqueda, setBusqueda] = useState('')
  const [termino, setTermino] = useState('')
  const [editando, setEditando] = useState<ClienteConDirecciones | 'nuevo' | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  // Debounce: la búsqueda es una consulta al servidor, no un filtro en memoria.
  useEffect(() => {
    const t = setTimeout(() => setTermino(busqueda.trim()), 300)
    return () => clearTimeout(t)
  }, [busqueda])

  const { data: total } = useQuery({ queryKey: ['clientes-total'], queryFn: contarClientes })

  const { data: clientes, isLoading, isFetching } = useQuery({
    queryKey: ['clientes', termino],
    queryFn: () => buscarClientesCartera(termino),
  })

  const { data: provisorios } = useQuery({
    queryKey: ['clientes-provisorios'],
    queryFn: clientesProvisorios,
  })

  const { data: vendedores } = useQuery({ queryKey: ['vendedores'], queryFn: vendedoresAsignables })

  const filtrados = clientes ?? []

  /**
   * Refresca TODO lo que mira esta pantalla.
   *
   * Invalidar sólo `['clientes']` deja viejas las otras dos consultas:
   * react-query compara las claves por prefijo y `['clientes-provisorios']` no
   * empieza con `'clientes'`, así que el aviso de "cargados desde la calle"
   * seguiría nombrando al cliente cuya ficha se acaba de completar, y el conteo
   * del encabezado no se movería al dar de alta uno nuevo.
   */
  function refrescarClientes() {
    for (const clave of [['clientes'], ['clientes-provisorios'], ['clientes-total']]) {
      void qc.invalidateQueries({ queryKey: clave })
    }
  }

  const alternar = useMutation({
    mutationFn: (c: Cliente) => alternarActivoCliente(c),
    onSuccess: () => {
      setAviso('Cliente actualizado.')
      refrescarClientes()
    },
    onError: (e: Error) => Alert.alert('No se pudo actualizar', e.message),
  })

  const nombreVendedor = (id: string | null) =>
    vendedores?.find((v) => v.id === id)?.nombre_completo ?? 'Sin asignar'

  return (
    <Pantalla>
      <Encabezado />

      <Panel contentStyle={estilos.contenido}>
        <BarraPanel alVolver={() => navigation.goBack()} />
        <TituloPanel>CLIENTES</TituloPanel>

        <Text style={estilos.subtitulo}>
          {total ?? '…'} clientes en la cartera
          {termino ? ` · ${filtrados.length} coinciden con "${termino}"` : ''}.
        </Text>

        <BotonMenu titulo="+  NUEVO CLIENTE" alTocar={() => setEditando('nuevo')} />

        {aviso ? (
          <Aviso tono="exito" titulo="Listo">
            {aviso}
          </Aviso>
        ) : null}

        {/* Los clientes que los vendedores cargan desde la calle nacen sin código
            real ni datos fiscales. Si no se muestran acá, quedan enterrados en la
            cartera y nadie los completa nunca. */}
        {provisorios && provisorios.length > 0 ? (
          <View style={estilos.provisorios}>
            <Aviso
              tono="atencion"
              titulo={`${provisorios.length} cargado${provisorios.length === 1 ? '' : 's'} desde la calle`}
            >
              {`${provisorios.length === 1 ? 'Espera' : 'Esperan'} que le${
                provisorios.length === 1 ? '' : 's'
              } asignes el código definitivo y completes la ficha. Tocá uno para completarlo:`}
            </Aviso>
            <View style={estilos.tiraProvisorios}>
              {provisorios.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() => setEditando(c)}
                  accessibilityRole="button"
                  accessibilityLabel={`Completar la ficha de ${c.razon_social}`}
                  style={({ pressed }) => [estilos.chipProvisorio, pressed && estilos.tocado]}
                >
                  <Text style={estilos.chipProvisorioTexto} numberOfLines={1}>
                    {c.razon_social}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <Campo
          value={busqueda}
          onChangeText={setBusqueda}
          placeholder="Buscar por código, razón social, fantasía o CUIT…"
          autoCapitalize="none"
          autoCorrect={false}
          accesorio={
            isFetching && termino ? <ActivityIndicator size="small" color={colores.rojo} /> : undefined
          }
        />

        {isLoading ? (
          <Cargando texto="Buscando en la cartera…" />
        ) : filtrados.length === 0 ? (
          <Vacio
            titulo="No hay clientes que coincidan"
            detalle={termino ? `Probá con otro dato de "${termino}".` : undefined}
            icono="🔍"
          />
        ) : (
          filtrados.map((c) => (
            <View key={c.id} style={estilos.fila}>
              <View style={estilos.filaCabecera}>
                <View style={estilos.filaCodigoCaja}>
                  <Text style={estilos.filaCodigo}>Nº {c.codigo}</Text>
                  {c.provisorio ? <Pastilla texto="PROVISORIO" color={colores.ambar} /> : null}
                </View>
                <Pastilla
                  texto={c.activo ? 'ACTIVO' : 'INACTIVO'}
                  color={c.activo ? colores.verde : colores.estadoPendiente}
                />
              </View>

              <Text style={estilos.filaRazon} numberOfLines={2}>
                {c.razon_social}
              </Text>
              {c.nombre_fantasia ? (
                <Text style={estilos.filaFantasia} numberOfLines={1}>
                  {c.nombre_fantasia}
                </Text>
              ) : null}

              <Text style={estilos.filaDato} numberOfLines={1}>
                <Text style={estilos.filaRotulo}>Contacto  </Text>
                {c.contacto_nombre ?? '—'}
                {c.telefono ? `  ·  ${c.telefono}` : ''}
              </Text>

              <Text style={estilos.filaDato} numberOfLines={1}>
                <Text style={estilos.filaRotulo}>Vendedor  </Text>
                {nombreVendedor(c.vendedor_id)}
              </Text>

              {/*
                Son tres estados distintos. El padrón importado tiene el domicilio
                escrito pero no geolocalizado: decirle "Sin dirección" a un cliente
                cuya calle está ahí sería falso, y esconde que lo que falta son las
                coordenadas para poder meterlo en un recorrido.
              */}
              <View style={estilos.filaDireccion}>
                {c.direcciones.length > 0 ? (
                  <Text style={estilos.filaDato} numberOfLines={2}>
                    <Text style={estilos.filaRotulo}>Dirección  </Text>
                    {(c.direcciones.find((d) => d.principal) ?? c.direcciones[0]).direccion_formateada}
                  </Text>
                ) : c.direccion ? (
                  <>
                    <Text style={estilos.filaDato} numberOfLines={2}>
                      <Text style={estilos.filaRotulo}>Dirección  </Text>
                      {[c.direccion, c.localidad].filter(Boolean).join(', ')}
                    </Text>
                    <Pastilla texto="Sin ubicar en el mapa" color={colores.ambar} />
                  </>
                ) : (
                  <Pastilla texto="Sin dirección" color={colores.rojoAccion} />
                )}
              </View>

              <View style={estilos.filaAcciones}>
                <Pressable
                  onPress={() => setEditando(c)}
                  accessibilityRole="button"
                  accessibilityLabel={`Editar ${c.razon_social}`}
                  style={({ pressed }) => [estilos.accion, pressed && estilos.tocado]}
                >
                  <Text style={estilos.accionTexto}>Editar</Text>
                </Pressable>
                <Pressable
                  onPress={() => alternar.mutate(c)}
                  disabled={alternar.isPending}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.activo ? 'Dar de baja' : 'Reactivar'} ${c.razon_social}`}
                  style={({ pressed }) => [
                    estilos.accion,
                    c.activo ? estilos.accionBaja : estilos.accionAlta,
                    pressed && estilos.tocado,
                  ]}
                >
                  <Text
                    style={[estilos.accionTexto, c.activo ? estilos.accionBajaTexto : estilos.accionAltaTexto]}
                  >
                    {c.activo ? 'Dar de baja' : 'Reactivar'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </Panel>

      {editando ? (
        <FormularioCliente
          cliente={editando === 'nuevo' ? null : editando}
          vendedores={vendedores ?? []}
          alCerrar={() => setEditando(null)}
          alGuardar={() => {
            setEditando(null)
            setAviso('Cliente guardado.')
            refrescarClientes()
          }}
        />
      ) : null}
    </Pantalla>
  )
}

/**
 * Una coordenada tipeada, como número.
 *
 * Se acepta la coma: en Argentina el separador decimal es la coma y el teclado
 * la ofrece primero, así que "-34,6037" es lo que sale naturalmente. Sin esto
 * `Number()` daría `NaN` y la dirección viajaría con lat/lng en null.
 */
function aCoordenada(texto: string): number {
  return Number(texto.trim().replace(',', '.'))
}

function FormularioCliente({
  cliente,
  vendedores,
  alCerrar,
  alGuardar,
}: {
  cliente: ClienteConDirecciones | null
  vendedores: Vendedor[]
  alCerrar: () => void
  alGuardar: () => void
}) {
  const estilos = usarEstilos()
  const { height: altoVentana } = useWindowDimensions()
  const alto = Math.round(altoVentana * 0.9)

  // La dirección principal es la marcada como tal o, si no hay ninguna, la
  // primera. Con su id se edita esa misma fila en vez de crear una nueva.
  const principal = cliente?.direcciones.find((d) => d.principal) ?? cliente?.direcciones[0]

  /**
   * El domicilio que trajo el listado del Gestión, cuando todavía no se ubicó.
   *
   * Los clientes importados tienen la calle escrita en su ficha
   * (`clientes.direccion`) y ninguna fila en `direcciones`, porque ésa exige
   * lat/lng. Se precarga acá para que la ficha del cliente "Sin ubicar en el
   * mapa" —el que alguien abre justamente para completarlo— no aparezca con la
   * dirección en blanco.
   */
  const domicilioDelPadron = [cliente?.direccion, cliente?.localidad].filter(Boolean).join(', ')

  const [form, setForm] = useState({
    codigo: cliente?.codigo ?? '',
    razon_social: cliente?.razon_social ?? '',
    nombre_fantasia: cliente?.nombre_fantasia ?? '',
    cuit: cliente?.cuit ?? '',
    contacto_nombre: cliente?.contacto_nombre ?? '',
    telefono: cliente?.telefono ?? '',
    email: cliente?.email ?? '',
    vendedor_id: cliente?.vendedor_id ?? '',
    direccion: principal?.direccion_formateada ?? domicilioDelPadron,
    codigo_postal: principal?.codigo_postal ?? cliente?.codigo_postal ?? '',
    lat: principal?.lat != null ? String(principal.lat) : '',
    lng: principal?.lng != null ? String(principal.lng) : '',
    notas: cliente?.notas ?? '',
  })

  const [errores, setErrores] = useState<Partial<Record<'codigo' | 'razon_social' | 'lat' | 'lng', string>>>(
    {},
  )
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)

  function actualizar(campo: keyof typeof form, valor: string) {
    setForm((f) => ({ ...f, [campo]: valor }))
  }

  const itemsVendedor = useMemo(
    () => [
      { valor: '', etiqueta: 'Sin asignar' },
      ...vendedores.map((v) => ({
        valor: v.id,
        etiqueta: v.nombre_completo,
        descripcion: v.codigo_vendedor ? `#${v.codigo_vendedor}` : undefined,
      })),
    ],
    [vendedores],
  )

  function validar(): boolean {
    const e: typeof errores = {}
    if (!form.codigo.trim()) e.codigo = 'Poné el número de cliente.'
    if (!form.razon_social.trim()) e.razon_social = 'Poné la razón social.'
    // Sin coordenadas el cliente no se puede meter en un recorrido: la ruta se
    // calcula sobre lat/lng, no sobre el texto de la dirección.
    if (form.direccion.trim()) {
      if (!form.lat.trim()) e.lat = 'Falta la latitud. Ej. -34,6037'
      else if (!Number.isFinite(aCoordenada(form.lat))) e.lat = 'Tiene que ser un número. Ej. -34,6037'
      if (!form.lng.trim()) e.lng = 'Falta la longitud. Ej. -58,3816'
      else if (!Number.isFinite(aCoordenada(form.lng))) e.lng = 'Tiene que ser un número. Ej. -58,3816'
    }
    setErrores(e)
    return Object.keys(e).length === 0
  }

  const guardar = useMutation({
    mutationFn: () => {
      const datos: DatosCliente = {
        codigo: form.codigo.trim(),
        razon_social: form.razon_social.trim(),
        nombre_fantasia: form.nombre_fantasia.trim() || null,
        cuit: form.cuit.trim() || null,
        telefono: form.telefono.trim() || null,
        email: form.email.trim() || null,
        contacto_nombre: form.contacto_nombre.trim() || null,
        vendedor_id: form.vendedor_id || null,
        notas: form.notas.trim() || null,
        // Asignarle un código real es lo que da por completada la ficha que
        // arrancó el vendedor en la calle. Mientras conserve el `P-` automático
        // sigue apareciendo en el aviso de pendientes.
        provisorio: form.codigo.trim().toUpperCase().startsWith('P-'),
      }
      const direccion: DatosDireccionPrincipal | null = form.direccion.trim()
        ? {
            direccion_formateada: form.direccion.trim(),
            codigo_postal: form.codigo_postal.trim() || null,
            lat: aCoordenada(form.lat),
            lng: aCoordenada(form.lng),
          }
        : null
      return guardarCliente({
        clienteId: cliente?.id ?? null,
        datos,
        direccion,
        direccionPrincipalId: principal?.id ?? null,
      })
    },
    onSuccess: () => alGuardar(),
    onError: (e: Error) => setErrorGeneral(e.message),
  })

  function intentarGuardar() {
    setErrorGeneral(null)
    if (validar()) guardar.mutate()
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={alCerrar}>
      <Pressable style={estilos.velo} onPress={alCerrar}>
        <Pressable style={[estilos.hoja, { height: alto }]} onPress={(e) => e.stopPropagation()}>
          <View style={estilos.hojaCabecera}>
            <Text style={estilos.hojaTitulo}>{cliente ? 'Editar cliente' : 'Nuevo cliente'}</Text>
            <Pressable
              onPress={alCerrar}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Cerrar"
              style={({ pressed }) => [estilos.hojaCerrar, pressed && estilos.tocado]}
            >
              <Text style={estilos.hojaCerrarTexto}>✕</Text>
            </Pressable>
          </View>

          {errorGeneral ? (
            <Aviso tono="error" titulo="No se pudo guardar">
              {errorGeneral}
            </Aviso>
          ) : null}

          <ScrollView
            style={estilos.hojaLista}
            contentContainerStyle={estilos.hojaContenido}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {cliente?.provisorio ? (
              <Aviso tono="atencion" titulo="Cliente cargado desde la calle">
                {`Lo cargó un vendedor durante el recorrido con el código ${cliente.codigo}. Cambiálo por el definitivo y completá lo que falte; con eso deja de figurar como provisorio.`}
              </Aviso>
            ) : null}

            <Campo
              etiqueta="Cliente Nº"
              obligatorio
              value={form.codigo}
              onChangeText={(t) => actualizar('codigo', t)}
              placeholder="Código de cliente"
              autoCapitalize="characters"
              autoCorrect={false}
              error={errores.codigo}
            />
            <Campo
              etiqueta="Razón social"
              obligatorio
              value={form.razon_social}
              onChangeText={(t) => actualizar('razon_social', t)}
              placeholder="Como figura en el sistema"
              autoCapitalize="words"
              error={errores.razon_social}
            />
            <Campo
              etiqueta="Nombre de fantasía"
              value={form.nombre_fantasia}
              onChangeText={(t) => actualizar('nombre_fantasia', t)}
              placeholder="Cómo lo conocen en la zona"
              autoCapitalize="words"
            />
            <Campo
              etiqueta="CUIT"
              value={form.cuit}
              onChangeText={(t) => actualizar('cuit', t)}
              placeholder="30-12345678-9"
              keyboardType="numbers-and-punctuation"
            />
            <Campo
              etiqueta="Contacto habitual"
              value={form.contacto_nombre}
              onChangeText={(t) => actualizar('contacto_nombre', t)}
              placeholder="Con quién se habla"
              autoCapitalize="words"
            />
            <Campo
              etiqueta="Teléfono"
              value={form.telefono}
              onChangeText={(t) => actualizar('telefono', t)}
              placeholder="11 4444 5555"
              keyboardType="phone-pad"
            />
            <Campo
              etiqueta="Correo"
              value={form.email}
              onChangeText={(t) => actualizar('email', t)}
              placeholder="cliente@correo.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Desplegable
              etiqueta="Vendedor a cargo"
              marcador="Sin asignar"
              valor={form.vendedor_id}
              items={itemsVendedor}
              alCambiar={(v) => actualizar('vendedor_id', v)}
              buscable={vendedores.length > 8}
            />

            <Text style={estilos.seccion}>Dirección principal</Text>

            <Campo
              etiqueta="Dirección"
              value={form.direccion}
              onChangeText={(t) => actualizar('direccion', t)}
              placeholder="Calle, número, localidad"
              autoCapitalize="words"
              ayuda="Si cargás una dirección, poné también la latitud y la longitud."
            />
            <Campo
              etiqueta="Código postal"
              value={form.codigo_postal}
              onChangeText={(t) => actualizar('codigo_postal', t)}
              placeholder="1704"
              autoCapitalize="characters"
              contenedorStyle={estilos.corto}
            />
            <Campo
              etiqueta="Latitud"
              value={form.lat}
              onChangeText={(t) => actualizar('lat', t)}
              placeholder="-34,6037"
              keyboardType="numbers-and-punctuation"
              contenedorStyle={estilos.corto}
              error={errores.lat}
            />
            <Campo
              etiqueta="Longitud"
              value={form.lng}
              onChangeText={(t) => actualizar('lng', t)}
              placeholder="-58,3816"
              keyboardType="numbers-and-punctuation"
              contenedorStyle={estilos.corto}
              error={errores.lng}
            />
            <Campo
              etiqueta="Notas"
              value={form.notas}
              onChangeText={(t) => actualizar('notas', t)}
              placeholder="Lo que haga falta recordar de este cliente"
              multiline
            />

            <MensajeError>
              {Object.keys(errores).length > 0 ? 'Revisá los campos marcados en rojo.' : undefined}
            </MensajeError>
          </ScrollView>

          <View style={estilos.hojaPie}>
            <BotonSecundario titulo="Cancelar" alTocar={alCerrar} style={estilos.pieBoton} />
            <BotonPrincipal
              titulo="Guardar"
              alTocar={intentarGuardar}
              cargando={guardar.isPending}
              style={estilos.pieBoton}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const usarEstilos = hojaDeTema((t) => ({
  contenido: { gap: espaciado.md },

  subtitulo: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tintaSuave,
    textAlign: 'center',
  },

  tocado: { opacity: 0.65 },

  // ── Aviso de provisorios ────────────────────────────────────────────────
  provisorios: { gap: espaciado.sm },
  tiraProvisorios: { flexDirection: 'row', flexWrap: 'wrap', gap: espaciado.xs },
  chipProvisorio: {
    maxWidth: '100%',
    minHeight: TOQUE_MINIMO - 12,
    justifyContent: 'center',
    paddingHorizontal: espaciado.md,
    paddingVertical: espaciado.xs,
    borderRadius: radios.sm,
    borderWidth: 2,
    borderColor: t.colores.ambarOscuro,
    backgroundColor: t.colores.campoBlanco,
  },
  chipProvisorioTexto: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tinta,
  },

  // ── Tarjeta de cliente ──────────────────────────────────────────────────
  fila: {
    backgroundColor: t.colores.campoBlanco,
    borderWidth: 1.5,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    padding: espaciado.md,
    gap: espaciado.xs,
  },
  filaCabecera: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: espaciado.sm,
  },
  filaCodigoCaja: { flexDirection: 'row', alignItems: 'center', gap: espaciado.sm, flexShrink: 1 },
  filaCodigo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tintaSuave,
    letterSpacing: 0.5,
  },
  filaRazon: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
  },
  filaFantasia: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
    marginTop: -2,
  },
  filaDato: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tinta,
  },
  filaRotulo: {
    fontFamily: t.tipografia.familia.subtitulo,
    color: t.colores.tintaSuave,
  },
  filaDireccion: { gap: espaciado.xs, marginTop: 2 },
  filaAcciones: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: espaciado.sm,
    marginTop: espaciado.xs,
  },
  accion: {
    minHeight: TOQUE_MINIMO - 12,
    justifyContent: 'center',
    paddingHorizontal: espaciado.base,
    borderRadius: radios.sm,
    borderWidth: 2,
    borderColor: t.colores.borde,
    backgroundColor: t.colores.panelClaro,
  },
  accionTexto: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tinta,
  },
  accionBaja: { backgroundColor: t.colores.campoBlanco, borderColor: t.colores.rojoAccion },
  accionBajaTexto: { color: t.colores.rojoAccion },
  accionAlta: { backgroundColor: t.colores.verde },
  accionAltaTexto: { color: t.colores.negro },

  // ── Hoja modal del formulario ───────────────────────────────────────────
  velo: {
    flex: 1,
    backgroundColor: t.colores.velo,
    justifyContent: 'flex-end',
  },
  hoja: {
    backgroundColor: t.colores.panel,
    borderTopWidth: 3,
    borderColor: t.colores.borde,
    borderTopLeftRadius: radios.lg,
    borderTopRightRadius: radios.lg,
    padding: espaciado.base,
    gap: espaciado.sm,
  },
  hojaCabecera: { flexDirection: 'row', alignItems: 'center', gap: espaciado.sm },
  hojaTitulo: {
    flex: 1,
    fontFamily: t.tipografia.familia.titulo,
    fontSize: t.tipografia.tamano.lg,
    color: t.colores.tinta,
    letterSpacing: 0.4,
  },
  hojaCerrar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colores.campoBlanco,
    borderWidth: 2,
    borderColor: t.colores.borde,
  },
  hojaCerrarTexto: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
  },
  hojaLista: { flex: 1 },
  hojaContenido: { gap: espaciado.md, paddingBottom: espaciado.md },
  seccion: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
    marginTop: espaciado.sm,
    letterSpacing: 0.3,
  },
  corto: { maxWidth: 200 },
  hojaPie: {
    flexDirection: 'row',
    gap: espaciado.sm,
    paddingTop: espaciado.sm,
  },
  pieBoton: { flex: 1, minWidth: 0, alignSelf: 'stretch' },
}))
