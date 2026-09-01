import type { ReporteProblema } from '@woodtools/compartido'
import Constants from 'expo-constants'
import * as Updates from 'expo-updates'

import { describirDispositivo } from '../nucleo/dispositivo'
import { supabase } from '../nucleo/supabase'

/**
 * Reportar un problema, con el contexto puesto.
 *
 * ─── Por qué la app agrega datos que el vendedor no escribió ─────────────────
 *
 * Porque son los que hacen falta para arreglarlo y los únicos que el vendedor
 * no tiene forma de saber. La versión de la app, el modelo del teléfono y el
 * código de instalación son la diferencia entre "a veces se traba" y "se traba
 * en la 1.0.7, en los Samsung A16, y en ninguno de los otros".
 *
 * No se le pide permiso para eso ni se le pregunta: es una app de trabajo, el
 * teléfono es de la empresa, y esconderle al que va a arreglar el problema el
 * número de versión de la app no protege a nadie.
 */

export interface ProblemaAReportar {
  /** El valor de `MOTIVOS_DE_PROBLEMA`. */
  motivo: string
  /** Lo que escribió cuando eligió "Otro", o lo que quiso agregar. */
  detalle?: string | null
  /** El segundo campo: cuándo suele darse. */
  cuandoSeDa?: string | null
  /**
   * Desde qué pantalla se reporta.
   *
   * Lo pone la pantalla que abre el formulario, no el vendedor. Sirve para el
   * caso más común: el que entra desde "¿No se te actualizó?" no está
   * contando lo mismo que el que entra desde el menú.
   */
  pantalla?: string | null
}

export async function reportarProblema(
  problema: ProblemaAReportar,
): Promise<ReporteProblema> {
  const equipo = await describirDispositivo().catch(() => null)

  const { data, error } = await supabase.rpc('reportar_problema', {
    p_motivo: problema.motivo,
    p_detalle: problema.detalle?.trim() || null,
    p_cuando_se_da: problema.cuandoSeDa?.trim() || null,
    p_pantalla: problema.pantalla?.trim() || null,
    p_version_app: versionQueCorre(),
    p_instalacion: equipo?.instalacion_id ?? null,
    p_modelo: equipo ? [equipo.fabricante, equipo.modelo, equipo.version_so].filter(Boolean).join(' · ') : null,
  })

  if (error) {
    // Los CHECK de la función vienen con el mensaje ya escrito para el vendedor.
    if (error.code === '23514') throw new Error(error.message)
    throw error
  }

  return data as ReporteProblema
}

/**
 * Qué versión está corriendo AHORA, no cuál se instaló.
 *
 * Es la distinción que importa justo en el reporte que más se va a usar: el de
 * "no se me actualizó". El número de versión sale del APK y no cambia cuando
 * baja una actualización por aire, así que dos teléfonos con el mismo 1.0.8
 * pueden estar corriendo código distinto. El identificador del paquete que se
 * está ejecutando es lo único que los distingue.
 */
function versionQueCorre(): string {
  const version = Constants.expoConfig?.version ?? '?'
  const canal = Updates.channel ?? String(Constants.expoConfig?.extra?.variante ?? 'interno')
  const paquete = Updates.isEmbeddedLaunch
    ? 'de fábrica'
    : (Updates.updateId ?? 'bajada').slice(0, 8)
  return `${version} · ${canal} · ${paquete}`
}

/**
 * Las respuestas de "cuándo suele darse" que ya escribieron otros.
 *
 * Es el desplegable que aprende. Si vuelve vacío —porque todavía nadie reportó
 * nada, o porque nadie repitió una frase— la pantalla muestra sólo el campo
 * para escribir, que es exactamente lo que hacía falta antes de que hubiera
 * historia.
 */
export async function cuandoSeDaFrecuente(motivo?: string | null): Promise<string[]> {
  const { data, error } = await supabase.rpc('cuando_se_da_frecuente', {
    p_motivo: motivo ?? null,
    p_limite: 8,
  })

  // Que no haya sugerencias no puede impedir reportar el problema: es una
  // ayuda, no un requisito. Un error acá se traga y se muestra el campo pelado.
  if (error) return []
  return ((data ?? []) as Array<{ texto: string }>).map((f) => f.texto).filter(Boolean)
}

/** Los problemas que reportó este vendedor, para saber si ya avisó y si le contestaron. */
export async function misReportes(limite = 20): Promise<ReporteProblema[]> {
  const { data, error } = await supabase
    .from('reportes_problema')
    .select('*')
    .order('creado_en', { ascending: false })
    .limit(limite)

  if (error) throw error
  return (data ?? []) as ReporteProblema[]
}
