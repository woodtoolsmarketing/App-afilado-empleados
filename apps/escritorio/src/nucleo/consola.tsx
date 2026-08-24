import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

/**
 * La consola del panel.
 *
 * Se abre con F12 y arranca vacía: no dice qué comandos hay ni que exista
 * alguno. Quien no sabe qué escribir, no encuentra nada mirando.
 *
 * ── Qué NO es ───────────────────────────────────────────────────────────────
 *
 * No evalúa JavaScript. Es una tabla de comandos y nada más. No es una decisión
 * de comodidad: la política de seguridad de contenido del panel prohíbe
 * `eval`, así que una consola de verdad no podría funcionar ni queriendo. Y es
 * mejor así — lo que se pidió es una puerta con llave, no un intérprete.
 *
 * ── Qué esconde, y qué no ───────────────────────────────────────────────────
 *
 * Esto es un gesto, no una defensa. El panel es Chromium y Ctrl+Shift+I abre
 * las herramientas de desarrollo de verdad: cualquier cosa que el navegador
 * haya recibido se puede leer, escriba uno lo que escriba acá.
 *
 * Por eso lo que de verdad protege está del otro lado. Los datos que este
 * comando destraba viven en una tabla con su propia política de lectura y
 * detrás de una función que exige un permiso por usuario: quien no lo tiene no
 * recibe la fila, y no hay pantalla que ocultar. La consola decide cuándo se
 * pide el dato; la base decide si se entrega.
 *
 * ── Por qué se olvida ───────────────────────────────────────────────────────
 *
 * El desbloqueo vive en memoria y se borra al cambiar de página o al recargar.
 * Fue parte del pedido: cada vez que haga falta mirar, hay que volver a entrar
 * y volver a escribirlo. Un permiso que queda prendido se convierte en un
 * permiso que nadie recuerda haber dado.
 */

/** Los comandos que la consola entiende. */
const COMANDOS: Record<string, { hace: string; destraba: string }> = {
  regedit: {
    hace: 'Muestra dónde se emitió cada nota de pedido.',
    destraba: 'ubicacion-de-notas',
  },
}

interface EstadoConsola {
  /** Qué está destrabado en este momento. Se vacía al navegar. */
  destrabado: (llave: string) => boolean
  abierta: boolean
  abrir: () => void
  cerrar: () => void
}

const Contexto = createContext<EstadoConsola>({
  destrabado: () => false,
  abierta: false,
  abrir: () => {},
  cerrar: () => {},
})

export function usarConsola(): EstadoConsola {
  return useContext(Contexto)
}

export function ProveedorConsola({
  children,
  rutaActual,
}: {
  children: React.ReactNode
  /** Cambiar de página borra lo destrabado. */
  rutaActual: string
}) {
  const [abierta, setAbierta] = useState(false)
  const [llaves, setLlaves] = useState<string[]>([])

  // Cambiar de página cierra la puerta. Es la mitad de "cada vez hay que
  // volver a escribirlo": sin esto, el desbloqueo sobreviviría toda la sesión.
  useEffect(() => {
    setLlaves([])
  }, [rutaActual])

  useEffect(() => {
    function alTeclado(e: KeyboardEvent) {
      if (e.key !== 'F12') return
      // Se le gana al navegador, que con F12 abriría sus propias herramientas.
      e.preventDefault()
      setAbierta((v) => !v)
    }
    window.addEventListener('keydown', alTeclado)
    return () => window.removeEventListener('keydown', alTeclado)
  }, [])

  const destrabar = useCallback((llave: string) => {
    setLlaves((previas) => (previas.includes(llave) ? previas : [...previas, llave]))
  }, [])

  return (
    <Contexto.Provider
      value={{
        destrabado: (llave) => llaves.includes(llave),
        abierta,
        abrir: () => setAbierta(true),
        cerrar: () => setAbierta(false),
      }}
    >
      {children}
      {abierta ? <Ventana alCerrar={() => setAbierta(false)} alDestrabar={destrabar} /> : null}
    </Contexto.Provider>
  )
}

function Ventana({
  alCerrar,
  alDestrabar,
}: {
  alCerrar: () => void
  alDestrabar: (llave: string) => void
}) {
  const [lineas, setLineas] = useState<string[]>([])
  const [texto, setTexto] = useState('')
  const entrada = useRef<HTMLInputElement>(null)
  const fondo = useRef<HTMLDivElement>(null)

  useEffect(() => {
    entrada.current?.focus()
  }, [])

  useEffect(() => {
    fondo.current?.scrollTo({ top: fondo.current.scrollHeight })
  }, [lineas])

  function ejecutar() {
    const comando = texto.trim().toLowerCase()
    setTexto('')
    if (!comando) return

    const nuevas = [`> ${comando}`]

    if (comando === 'salir' || comando === 'exit') {
      alCerrar()
      return
    }

    const encontrado = COMANDOS[comando]
    if (encontrado) {
      alDestrabar(encontrado.destraba)
      nuevas.push(encontrado.hace)
      // Se avisa que se apaga solo: si no, la próxima vez parece que se rompió.
      nuevas.push('Se apaga al cambiar de página.')
    } else {
      // El mismo texto para un comando que no existe y para uno que existe pero
      // no le corresponde a este usuario: la diferencia entre las dos cosas es
      // justamente lo que no conviene contar.
      nuevas.push(`${comando}: no se reconoce como un comando.`)
    }

    setLineas((previas) => [...previas, ...nuevas])
  }

  return (
    <div className="consola-fondo" onClick={alCerrar}>
      <div className="consola" onClick={(e) => e.stopPropagation()}>
        <div className="consola-salida" ref={fondo}>
          {lineas.map((l, i) => (
            <div key={i} className={l.startsWith('>') ? 'consola-eco' : undefined}>
              {l}
            </div>
          ))}
        </div>
        <div className="consola-entrada">
          <span>&gt;</span>
          <input
            ref={entrada}
            value={texto}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') ejecutar()
              if (e.key === 'Escape') alCerrar()
            }}
          />
        </div>
      </div>
    </div>
  )
}
