import { versionAtrasada } from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { supabase } from '../nucleo/supabase'

/**
 * Qué versión tiene cada celular, y cómo empujarlos a la nueva.
 *
 * ─── Las dos formas de actualizar, y por qué hacen falta las dos ────────────
 *
 * **Por aire (OTA).** La app se baja sola el código nuevo al abrirla. Es lo que
 * resuelve el 90 % de los casos —un texto, un cálculo, una pantalla— sin que
 * nadie tenga que instalar nada. Se publica con el botón de acá abajo.
 *
 * **Reinstalando el APK.** Hace falta cuando cambia algo que no es JavaScript:
 * un permiso nuevo, una librería nativa, la versión de Android. Eso no viaja
 * por aire y no hay forma de que viaje.
 *
 * La **versión mínima** es la que separa una de la otra: mientras los celulares
 * puedan ponerse al día solos, no molesta a nadie. Cuando un cambio deja de ser
 * compatible con las versiones viejas —una columna que ya no existe, una nota
 * que se guarda distinto— se sube el mínimo y el que esté atrasado ve un cartel
 * al entrar en vez de errores que no entiende.
 */

const CLAVE_VERSION_MINIMA = 'version_minima_app'

/** Un APK ya publicado, tal como lo baja el vendedor. */
interface VersionPublicada {
  canal: string
  version: string
  /**
   * Dónde está el instalador. Uno de los dos, nunca ninguno.
   *
   * El bucket no acepta archivos de más de 50 MB —es el tope del plan, medido:
   * 40 MB entra, 55 devuelve 413— y un APK pesa 78. Así que los APK viven en el
   * servidor de compilación y la fila guarda el link; `archivo` queda para lo
   * que sí entre, como el instalador de escritorio.
   */
  archivo: string | null
  url_externa: string | null
  tamano_bytes: number | null
  notas: string | null
  publicado_en: string
}

const NOMBRE_CANAL: Record<string, string> = {
  interno: 'Interno',
  beta: 'Beta',
  produccion: 'Producción',
}

interface DispositivoConDuenio {
  id: string
  instalacion_id: string
  version_app: string | null
  modelo: string | null
  fabricante: string | null
  autorizado: boolean
  ultimo_visto_en: string | null
  perfiles: { nombre_completo: string; codigo_vendedor: string | null } | null
}

export function PaginaActualizaciones({ soloLectura }: { soloLectura: boolean }) {
  const cliente = useQueryClient()
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [minimaEditada, setMinimaEditada] = useState<string | null>(null)
  const [salidaPublicar, setSalidaPublicar] = useState<string | null>(null)

  const { data: minima } = useQuery({
    queryKey: ['configuracion', CLAVE_VERSION_MINIMA],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('configuracion')
        .select('valor')
        .eq('clave', CLAVE_VERSION_MINIMA)
        .maybeSingle()
      if (error) throw error
      return (data?.valor as { android?: string } | null)?.android ?? '0.0.0'
    },
  })

  const { data: dispositivos, isLoading } = useQuery({
    queryKey: ['dispositivos', 'versiones'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dispositivos')
        .select('*, perfiles ( nombre_completo, codigo_vendedor )')
        .order('ultimo_visto_en', { ascending: false, nullsFirst: false })
      if (error) throw error
      return data as unknown as DispositivoConDuenio[]
    },
  })

  const guardarMinima = useMutation({
    mutationFn: async (version: string) => {
      const { error } = await supabase
        .from('configuracion')
        .update({ valor: { android: version } })
        .eq('clave', CLAVE_VERSION_MINIMA)
      if (error) throw error
    },
    onSuccess: () => {
      setMensaje('Versión mínima actualizada.')
      setMinimaEditada(null)
      void cliente.invalidateQueries({ queryKey: ['configuracion'] })
    },
    onError: (e: Error) => setMensaje(`No se pudo guardar: ${e.message}`),
  })

  /**
   * Publicar corre `eas update` en esta máquina, a través del proceso principal
   * de Electron. No lo hace la nube ni el navegador: hace falta el código del
   * proyecto y una sesión de Expo, y las dos cosas viven en la PC de la oficina.
   *
   * Por eso el botón no aparece en una máquina donde sólo esté instalado el
   * panel: no habría qué publicar.
   */
  const publicar = useMutation({
    mutationFn: async (canal: string) => {
      const puente = window.woodtools
      if (!puente?.publicarActualizacion) {
        throw new Error(
          'Esta copia del panel no puede publicar: hace falta tenerla abierta desde la carpeta del proyecto.',
        )
      }
      return puente.publicarActualizacion(canal)
    },
    onSuccess: (r) => {
      setSalidaPublicar(r.salida)
      setMensaje(r.ok ? 'Actualización publicada.' : 'La publicación terminó con error.')
    },
    onError: (e: Error) => setMensaje(e.message),
  })

  /**
   * Publicar sólo tiene sentido si el proyecto está en esta máquina. Se lo
   * pregunta al proceso principal en vez de suponerlo: el puente existe
   * siempre, la carpeta del código no.
   */
  const { data: puedePublicar = false } = useQuery({
    queryKey: ['proyecto-disponible'],
    queryFn: async () => (await window.woodtools?.proyectoDisponible?.()) ?? false,
  })

  /**
   * ¿El circuito de actualizaciones está realmente prendido?
   *
   * Se pregunta aparte de "¿está el proyecto?" porque son dos cosas distintas y
   * fallaban distinto. El proyecto estuvo siempre; lo que faltaba era la URL de
   * actualizaciones, y sin ella la app se compila sin poder recibirlas. Durante
   * seis versiones el botón dijo que publicaba y no le llegó a ningún teléfono.
   */
  const { data: otaPrendido = false } = useQuery({
    queryKey: ['actualizaciones-configuradas'],
    queryFn: async () => (await window.woodtools?.actualizacionesConfiguradas?.()) ?? false,
  })

  /**
   * A qué teléfonos llega. Cada APK se compila escuchando un canal y sólo
   * recibe lo que se publica ahí, así que elegir mal es publicar al vacío.
   */
  const [canal, setCanal] = useState('interno')

  // ── Compilar el APK y dejarlo para bajar ──────────────────────────────────
  const [paso, setPaso] = useState<{ etapa: string; detalle: string } | null>(null)
  const [notasVersion, setNotasVersion] = useState('')

  /** El puente avisa en qué anda; sin desuscribirse, cada visita suma un oyente. */
  useEffect(() => window.woodtools?.alAvanzarCompilacion?.(setPaso), [])

  const { data: herramientas } = useQuery({
    queryKey: ['herramientas-de-compilacion'],
    queryFn: async () =>
      (await window.woodtools?.herramientasDeCompilacion?.()) ?? {
        proyecto: false,
        jdk: null,
        sdk: null,
      },
  })

  /** La última versión publicada de cada canal, que es lo que baja el vendedor. */
  const { data: versiones } = useQuery({
    queryKey: ['versiones-app'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('versiones_app')
        .select('canal, version, archivo, url_externa, tamano_bytes, notas, publicado_en')
        .order('publicado_en', { ascending: false })
        .limit(12)
      if (error) throw error
      return data as VersionPublicada[]
    },
  })

  const compilar = useMutation({
    mutationFn: async () => {
      const puente = window.woodtools
      if (!puente?.compilarApk) {
        throw new Error('Esta copia del panel no puede compilar: falta la carpeta del proyecto.')
      }

      /**
       * El token de la sesión viaja al proceso principal para que la subida la
       * autorice la base. Así "sólo Administración publica" sigue siendo una
       * regla del servidor y no una condición en el código del panel.
       */
      const { data: sesion } = await supabase.auth.getSession()
      const token = sesion.session?.access_token
      if (!token) throw new Error('Se venció la sesión. Volvé a entrar al panel.')

      const r = await puente.compilarApk({
        canal,
        token,
        supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string,
        anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      })
      if (!r.ok) throw new Error(r.salida)

      // Recién se anota cuando el archivo ya está arriba: una fila que apunta a
      // un APK que no se subió es peor que no tener fila.
      const { error } = await supabase.from('versiones_app').insert({
        canal,
        version: r.version ?? '0.0.0',
        archivo: r.archivo!,
        tamano_bytes: r.tamano ?? null,
        notas: notasVersion.trim() || null,
      })
      if (error) throw error
      return r
    },
    onSuccess: () => {
      setPaso(null)
      setNotasVersion('')
      setMensaje('APK compilado y publicado. Los vendedores ya lo pueden bajar.')
      void cliente.invalidateQueries({ queryKey: ['versiones-app'] })
    },
    onError: (e: Error) => {
      setPaso(null)
      setSalidaPublicar(e.message)
      setMensaje('La compilación no terminó.')
    },
  })

  const puedeCompilar = !!herramientas?.proyecto && !!herramientas.jdk && !!herramientas.sdk

  const exigida = minimaEditada ?? minima ?? '0.0.0'

  return (
    <>
      <header className="encabezado">
        <h1>Actualizaciones</h1>
      </header>

      {mensaje && (
        <div className="aviso" role="status">
          {mensaje}
        </div>
      )}

      {/* ── Versión mínima ──────────────────────────────────────────────── */}
      <section className="tarjeta">
        <h2>Versión mínima exigida</h2>
        <p style={{ color: 'var(--tinta-suave)', fontSize: 13, marginBottom: 12 }}>
          El celular que tenga una versión más vieja ve un cartel al entrar y no puede seguir hasta
          actualizar. En <code>0.0.0</code> no molesta a nadie: subila sólo cuando un cambio deje de
          ser compatible con las versiones viejas.
        </p>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            value={exigida}
            onChange={(e) => setMinimaEditada(e.target.value.replace(/[^0-9.]/g, ''))}
            disabled={soloLectura}
            style={{ width: 120 }}
            aria-label="Versión mínima"
          />
          {minimaEditada !== null && minimaEditada !== minima && (
            <button
              className="primario chico"
              disabled={soloLectura || guardarMinima.isPending}
              onClick={() => guardarMinima.mutate(exigida)}
            >
              Guardar
            </button>
          )}
        </div>
      </section>

      {/* ── Publicar ────────────────────────────────────────────────────── */}
      <section className="tarjeta">
        <h2>Publicar una actualización por aire</h2>
        <p style={{ color: 'var(--tinta-suave)', fontSize: 13, marginBottom: 12 }}>
          Manda el código nuevo a todos los celulares. Lo aplican al abrir la app, sin reinstalar
          nada. No sirve para cambios que tocan lo nativo —un permiso, una librería—: eso necesita
          un APK nuevo.
        </p>

        {/* Antes que nada: si el circuito está apagado, publicar no sirve y
            decirlo vale más que un botón que miente. */}
        {puedePublicar && !otaPrendido && (
          <div className="aviso atencion" style={{ marginBottom: 12 }}>
            <strong>Las actualizaciones por aire están apagadas.</strong> Falta completar{' '}
            <code>EAS_UPDATE_URL</code> en el <code>.env</code> del proyecto. Mientras esté vacía,
            la app se compila sin poder recibirlas y lo que se publique no le llega a ningún
            celular. Hay que completarla y compilar un APK nuevo; a partir de ése, sí.
          </div>
        )}

        {puedePublicar ? (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
              <span style={{ color: 'var(--tinta-suave)' }}>A qué celulares</span>
              <select
                value={canal}
                onChange={(e) => setCanal(e.target.value)}
                disabled={soloLectura || publicar.isPending}
              >
                <option value="interno">Interno — los de prueba</option>
                <option value="beta">Beta — los que están probando</option>
                <option value="produccion">Producción — todos los vendedores</option>
              </select>
            </label>

            <button
              className="primario"
              disabled={soloLectura || publicar.isPending || !otaPrendido}
              onClick={() => {
                /* El canal va en la pregunta: publicar al que no era es el
                   error caro, y una vez publicado no se deshace. */
                if (confirm(`¿Publicar la actualización a los celulares del canal "${canal}"?`)) {
                  publicar.mutate(canal)
                }
              }}
            >
              {publicar.isPending
                ? 'Publicando… (puede tardar unos minutos)'
                : 'Publicar actualización'}
            </button>
          </div>
        ) : (
          <div className="aviso atencion">
            Esta copia del panel no puede publicar. Hay que abrirlo desde la carpeta del proyecto, en
            la PC que tiene el código y la sesión de Expo.
          </div>
        )}

        {/* ── Compilar un APK nuevo ──────────────────────────────────────────
            Va acá abajo, después de publicar por aire, porque ése es el orden
            en que conviene intentarlo: por aire resuelve casi todo y tarda un
            minuto; compilar tarda media hora y obliga a reinstalar. */}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--borde, #ddd)' }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>Compilar un APK nuevo</h3>
          <p style={{ color: 'var(--tinta-suave)', fontSize: 13, marginBottom: 12 }}>
            Hace falta sólo cuando cambia algo nativo: un permiso, una librería, la versión de
            Android. Se compila acá y queda listo para que cada vendedor lo baje desde su
            teléfono. Tarda varios minutos.
          </p>

          {puedeCompilar ? (
            <>
              <label style={{ display: 'block', fontSize: 13, marginBottom: 10 }}>
                <span style={{ color: 'var(--tinta-suave)' }}>Qué trae esta versión (opcional)</span>
                <input
                  type="text"
                  value={notasVersion}
                  onChange={(e) => setNotasVersion(e.target.value)}
                  placeholder="Ej. Arregla el precio al separar renglones"
                  disabled={soloLectura || compilar.isPending}
                  style={{ display: 'block', width: '100%', maxWidth: 460, marginTop: 4 }}
                />
              </label>

              <button
                className="primario"
                disabled={soloLectura || compilar.isPending}
                onClick={() => {
                  if (confirm(`¿Compilar el APK del canal "${canal}"? Puede tardar varios minutos.`)) {
                    compilar.mutate()
                  }
                }}
              >
                {compilar.isPending ? 'Compilando…' : 'Compilar y publicar el APK'}
              </button>

              {/* Media hora de ventana quieta se lee como colgada: se muestra
                  en qué anda, con la última línea que largó Gradle. */}
              {compilar.isPending && paso && (
                <div className="aviso info" style={{ marginTop: 10, fontSize: 13 }}>
                  <strong>
                    {paso.etapa === 'preparando'
                      ? 'Preparando el proyecto'
                      : paso.etapa === 'compilando'
                        ? 'Compilando'
                        : 'Subiendo'}
                  </strong>
                  <div
                    style={{
                      fontFamily: 'ui-monospace, Consolas, monospace',
                      fontSize: 11,
                      color: 'var(--tinta-suave)',
                      marginTop: 4,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {paso.detalle}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="aviso atencion">
              Esta máquina no puede compilar todavía. Falta:{' '}
              {[
                !herramientas?.proyecto && 'la carpeta del proyecto',
                !herramientas?.jdk && 'el JDK 17',
                !herramientas?.sdk && 'el SDK de Android',
              ]
                .filter(Boolean)
                .join(', ')}
              . Por aire se puede publicar igual.
            </div>
          )}
        </div>

        {/* ── Lo que hay para bajar ──────────────────────────────────────── */}
        {versiones && versiones.length > 0 && (
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--borde, #ddd)' }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>APK publicados</h3>
            <table style={{ width: '100%', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Canal</th>
                  <th style={{ textAlign: 'left' }}>Versión</th>
                  <th style={{ textAlign: 'left' }}>Qué trae</th>
                  <th style={{ textAlign: 'right' }}>Tamaño</th>
                  <th style={{ textAlign: 'left' }}>Publicado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {versiones.map((v) => (
                  <tr key={`${v.canal}-${v.publicado_en}`}>
                    <td>{NOMBRE_CANAL[v.canal] ?? v.canal}</td>
                    <td>{v.version}</td>
                    <td style={{ color: 'var(--tinta-suave)' }}>{v.notas ?? '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {v.tamano_bytes ? `${Math.round(v.tamano_bytes / 1_048_576)} MB` : '—'}
                    </td>
                    <td style={{ color: 'var(--tinta-suave)' }}>
                      {new Date(v.publicado_en).toLocaleDateString('es-AR')}
                    </td>
                    {/* La tabla listaba los APK publicados sin ninguna forma de
                        bajarlos, que es como un estante con vitrina cerrada.
                        Abre en el navegador del sistema: el instalador lo tiene
                        que recibir el teléfono, no esta ventana. */}
                    <td>
                      {v.url_externa ? (
                        <button
                          className="chico"
                          onClick={() => void window.woodtools?.abrirExterno(v.url_externa!)}
                        >
                          Bajar APK
                        </button>
                      ) : (
                        <span style={{ color: 'var(--tinta-tenue)' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {salidaPublicar && (
          <pre
            style={{
              marginTop: 12,
              maxHeight: 260,
              overflow: 'auto',
              fontSize: 12,
              background: 'var(--panel-oscuro, #f4f4f4)',
              padding: 12,
              borderRadius: 6,
            }}
          >
            {salidaPublicar}
          </pre>
        )}
      </section>

      {/* ── Qué versión tiene cada uno ──────────────────────────────────── */}
      <section className="tarjeta">
        <h2>Celulares ({dispositivos?.length ?? 0})</h2>

        {isLoading ? (
          <p>Cargando…</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Vendedor</th>
                <th>Equipo</th>
                <th>Versión</th>
                <th>Estado</th>
                <th>Último uso</th>
              </tr>
            </thead>
            <tbody>
              {(dispositivos ?? []).map((d) => {
                const version = d.version_app ?? null
                const atrasada = versionAtrasada(version, exigida)
                return (
                  <tr key={d.id}>
                    <td>
                      {d.perfiles?.nombre_completo ?? '—'}
                      {d.perfiles?.codigo_vendedor ? ` (#${d.perfiles.codigo_vendedor})` : ''}
                    </td>
                    <td>
                      {[d.fabricante, d.modelo].filter(Boolean).join(' ') || '—'}
                      <br />
                      <small style={{ color: 'var(--tinta-tenue)' }}>
                        <code>{d.instalacion_id.slice(0, 8).toUpperCase()}</code>
                      </small>
                    </td>
                    <td>{version ?? '—'}</td>
                    <td>
                      {!d.autorizado ? (
                        <span className="pastilla">Sin autorizar</span>
                      ) : atrasada ? (
                        <span className="pastilla atencion">Atrasada</span>
                      ) : (
                        <span className="pastilla exito">Al día</span>
                      )}
                    </td>
                    <td>
                      {d.ultimo_visto_en
                        ? new Date(d.ultimo_visto_en).toLocaleString('es-AR', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })
                        : 'Nunca'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}
