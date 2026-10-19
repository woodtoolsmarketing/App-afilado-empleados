import { espaciado, radios } from '@woodtools/compartido'
import { useIsFocused } from '@react-navigation/native'
import { useQuery } from '@tanstack/react-query'
import { Text, View } from 'react-native'

import { BotonSecundario } from '../componentes/Botones'
import { Aviso, Cargando, Vacio } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { miColaDeImpresion, type OrdenEnMiCola } from '../servicios/cola'
import { hojaDeTema } from '../nucleo/tema'
import type { PropsPantalla } from '../navegacion/tipos'

/**
 * "MIS IMPRESIONES"
 *
 * Lo que el vendedor mandó a imprimir a la oficina (notas, rol, cobranzas) con su
 * POSICIÓN en la cola: "2º de 5", "la próxima", "imprimiéndose". La oficina las
 * saca en orden de llegada; esto refresca solo para que el puesto baje en vivo.
 */
export function PantallaMisImpresiones({ navigation }: PropsPantalla<'MisImpresiones'>) {
  const estilos = usarEstilos()

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

  const ordenes = data ?? []

  return (
    <Pantalla>
      <Encabezado />
      <Panel contentStyle={estilos.contenido}>
        <BarraPanel alVolver={() => navigation.goBack()} />
        <TituloPanel>{'MIS\nIMPRESIONES'}</TituloPanel>

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
        ) : (
          <Vacio
            titulo="No tenés nada esperando"
            detalle="Cuando mandes una nota, el rol de visita o las cobranzas a la oficina, aparecen acá con su lugar en la cola."
            icono="🖨️"
          />
        )}
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

const usarEstilos = hojaDeTema((t) => ({
  contenido: { gap: espaciado.md },
  ayuda: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
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
}))
