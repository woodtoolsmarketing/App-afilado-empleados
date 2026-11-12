import { espaciado, formatearFechaCorta, radios, TOQUE_MINIMO } from '@woodtools/compartido'
import { useIsFocused } from '@react-navigation/native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Pressable, Text, View } from 'react-native'

import { BotonSecundario } from '../componentes/Botones'
import { BotonReportarProblema } from '../componentes/BotonReportarProblema'
import { Aviso, Cargando, Vacio } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import {
  encolarRol,
  historialDeRolesPropio,
  miColaDeImpresion,
  type OrdenEnMiCola,
  type RolImpreso,
} from '../servicios/cola'
import { hojaDeTema, usarTema } from '../nucleo/tema'
import type { PropsPantalla } from '../navegacion/tipos'

/**
 * "MIS IMPRESIONES"
 *
 * Lo que el vendedor mandó a imprimir a la oficina (notas, rol, cobranzas) con su
 * POSICIÓN en la cola: "2º de 5", "la próxima", "imprimiéndose". La oficina las
 * saca en orden de llegada; esto refresca solo para que el puesto baje en vivo.
 *
 * Abajo, el HISTORIAL de roles (#8): los roles que ya se imprimieron (o fallaron),
 * para volver a mandarlos a la oficina de un toque. Los que todavía están en la
 * cola salen arriba con su puesto, así que acá no se repiten.
 */
export function PantallaMisImpresiones({ navigation }: PropsPantalla<'MisImpresiones'>) {
  const estilos = usarEstilos()
  const cola = useQueryClient()

  // Sólo sondea mientras el vendedor está MIRANDO esta pantalla: si se va a otra
  // (por el menú), deja de pegarle al servidor cada 8s —son dos count por orden
  // y por 15-30 vendedores sería carga al pedo—.
  const enfocado = useIsFocused()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['mi-cola-impresion'],
    queryFn: miColaDeImpresion,
    // Refresca para que la posición baje a medida que la oficina imprime.
    refetchInterval: enfocado ? 8_000 : false,
  })

  const { data: historial = [] } = useQuery({
    queryKey: ['historial-roles-propio'],
    queryFn: historialDeRolesPropio,
  })

  const reimprimir = useMutation({
    mutationFn: (fecha: string) => encolarRol(fecha),
    onSuccess: (r) => {
      // Vuelve a la cola de arriba: refrescamos para que aparezca con su puesto.
      void cola.invalidateQueries({ queryKey: ['mi-cola-impresion'] })
      Alert.alert(
        r.encolada ? 'Va a la oficina' : 'Ya estaba pedido',
        r.encolada
          ? 'El rol volvió a la cola. Lo imprimen en la oficina; mirá tu lugar acá arriba.'
          : (r.motivo ?? 'Ya hay un pedido de ese rol esperando en la oficina.'),
      )
    },
    onError: (e: Error) => Alert.alert('No pudimos mandarlo a la oficina', e.message),
  })

  const ordenes = data ?? []
  const hayHistorial = historial.length > 0

  return (
    <Pantalla>
      <Encabezado />
      <Panel contentStyle={estilos.contenido}>
        <BarraPanel alVolver={() => navigation.goBack()} />
        <TituloPanel unaLinea>MIS IMPRESIONES</TituloPanel>

        <Text style={estilos.ayuda}>
          Lo que mandaste a imprimir a la oficina. La PC de la oficina lo saca en orden de llegada;
          acá ves en qué lugar va cada cosa.
        </Text>

        {ordenes.length > 0 ? (
          <>
            {/* Si el último sondeo falló pero ya teníamos la cola, se muestra
                igual —la oficina la tiene— con un aviso chico, en vez de tapar
                todo con un error. El vendedor trabaja con señal intermitente:
                mejor lo último que una pantalla vacía. */}
            {isError ? (
              <Aviso tono="atencion">
                No pudimos actualizar (revisá la señal). Te mostramos lo último que trajimos.
              </Aviso>
            ) : null}
            <View style={estilos.lista}>
              {ordenes.map((o) => (
                <Fila key={o.id} orden={o} />
              ))}
            </View>
          </>
        ) : isLoading ? (
          <Cargando texto="Buscando tu cola…" />
        ) : isError ? (
          <>
            <Aviso tono="error" titulo="No pudimos traer tu cola">
              Revisá la señal y reintentá. Lo que mandaste sigue en la oficina igual.
            </Aviso>
            <BotonSecundario titulo="↻  Reintentar" alTocar={() => void refetch()} />
          </>
        ) : hayHistorial ? (
          // Si no hay nada en la cola pero sí hay historial de roles, no tapamos
          // la pantalla con el vacío grande: una línea y abajo el historial.
          <Text style={estilos.colaVacia}>No tenés nada esperando en la cola.</Text>
        ) : (
          <Vacio
            titulo="No tenés nada esperando"
            detalle="Cuando mandes una nota, el rol de visita o las cobranzas a la oficina, aparecen acá con su lugar en la cola."
            icono="🖨️"
          />
        )}

        {/* ── Historial de roles (#8) ─────────────────────────────────────── */}
        {hayHistorial ? (
          <View style={estilos.historial}>
            <Text style={estilos.historialTitulo}>HISTORIAL DE ROLES</Text>
            <Text style={estilos.ayuda}>
              Roles que ya mandaste a imprimir. Podés volver a mandarlos a la oficina.
            </Text>
            {historial.map((r) => (
              <FilaHistorial
                key={r.id}
                rol={r}
                reencolando={reimprimir.isPending}
                alReimprimir={() => reimprimir.mutate(r.fecha)}
              />
            ))}
          </View>
        ) : null}

        <BotonReportarProblema
          pantalla="Mis impresiones"
          motivo="impresion"
          detalle={'Estaba en "Mis impresiones" (la cola de impresión).'}
        />
      </Panel>
    </Pantalla>
  )
}

function Fila({ orden }: { orden: OrdenEnMiCola }) {
  const estilos = usarEstilos()
  const imprimiendo = orden.estado === 'imprimiendo'

  const estado = imprimiendo
    ? 'Imprimiéndose ahora…'
    : orden.posicion <= 1
      ? 'Es la próxima en salir'
      : `Puesto ${orden.posicion} de ${orden.total_en_cola} en la cola`

  return (
    <View style={[estilos.fila, imprimiendo && estilos.filaImprimiendo]}>
      <View style={[estilos.puesto, imprimiendo && estilos.puestoImprimiendo]}>
        {imprimiendo ? (
          <Text style={estilos.puestoIcono}>🖨️</Text>
        ) : (
          <Text style={estilos.puestoNum}>{orden.posicion}</Text>
        )}
      </View>
      <View style={estilos.datos}>
        <Text style={estilos.desc}>{orden.descripcion}</Text>
        <Text style={[estilos.estado, imprimiendo && estilos.estadoImprimiendo]}>{estado}</Text>
      </View>
    </View>
  )
}

/**
 * Una línea del historial de roles: la fecha del rol, cómo terminó, y un botón
 * para volver a mandarlo a la oficina.
 */
function FilaHistorial({
  rol,
  reencolando,
  alReimprimir,
}: {
  rol: RolImpreso
  reencolando: boolean
  alReimprimir: () => void
}) {
  const estilos = usarEstilos()
  const { colores } = usarTema()

  const fecha = rol.fecha ? formatearFechaCorta(`${rol.fecha}T12:00:00`) : 'Sin fecha'
  const { texto, color } =
    rol.estado === 'impresa'
      ? { texto: '✓ Impreso', color: colores.estadoVisitada }
      : rol.estado === 'fallida'
        ? {
            texto: `✗ No se pudo imprimir${rol.motivo_fallo ? ` · ${rol.motivo_fallo}` : ''}`,
            color: colores.rojoAccion,
          }
        : { texto: 'Cancelado', color: colores.tintaSuave }

  return (
    <View style={estilos.histFila}>
      <View style={estilos.datos}>
        <Text style={estilos.desc}>Rol del {fecha}</Text>
        <Text style={[estilos.estado, { color }]}>{texto}</Text>
      </View>
      <Pressable
        onPress={alReimprimir}
        disabled={reencolando}
        accessibilityRole="button"
        accessibilityLabel={`Reimprimir el rol del ${fecha}`}
        style={({ pressed }) => [
          estilos.reimprimir,
          pressed && estilos.reimprimirTocado,
          reencolando && estilos.reimprimirInerte,
        ]}
      >
        <Text style={estilos.reimprimirTexto}>Reimprimir</Text>
      </Pressable>
    </View>
  )
}

const usarEstilos = hojaDeTema((t) => ({
  contenido: { gap: espaciado.md },
  ayuda: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  colaVacia: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tintaSuave,
  },
  lista: { gap: espaciado.sm },
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.md,
    backgroundColor: t.colores.panelClaro,
    borderRadius: radios.sm,
    padding: espaciado.md,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  filaImprimiendo: { borderColor: t.colores.verdeOscuro, backgroundColor: t.colores.campoBlanco },
  puesto: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: t.colores.panelOscuro,
    alignItems: 'center',
    justifyContent: 'center',
  },
  puestoImprimiendo: { backgroundColor: t.colores.verdeOscuro },
  puestoNum: {
    fontFamily: t.tipografia.familia.titulo,
    fontSize: t.tipografia.tamano.lg,
    color: t.colores.tinta,
  },
  puestoIcono: { fontSize: t.tipografia.tamano.base },
  datos: { flex: 1, gap: 2 },
  desc: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
  },
  estado: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tintaSuave,
  },
  estadoImprimiendo: { color: t.colores.verdeOscuro, fontFamily: t.tipografia.familia.fuerte },

  // Historial de roles
  historial: {
    gap: espaciado.sm,
    marginTop: espaciado.sm,
    borderTopWidth: 1.5,
    borderTopColor: t.colores.borde,
    paddingTop: espaciado.md,
  },
  historialTitulo: {
    fontFamily: t.tipografia.familia.titulo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },
  histFila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.sm,
    backgroundColor: t.colores.panelClaro,
    borderRadius: radios.sm,
    padding: espaciado.md,
  },
  reimprimir: {
    minHeight: TOQUE_MINIMO,
    paddingHorizontal: espaciado.md,
    justifyContent: 'center',
    borderRadius: radios.sm,
    borderWidth: 2,
    borderColor: t.colores.borde,
    backgroundColor: t.colores.campoBlanco,
  },
  reimprimirTocado: { opacity: 0.6 },
  reimprimirInerte: { opacity: 0.4 },
  reimprimirTexto: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },
}))
