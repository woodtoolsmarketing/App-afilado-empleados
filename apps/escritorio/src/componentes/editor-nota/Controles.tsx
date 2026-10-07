import { useId, type ReactNode } from 'react'

/**
 * Controles de formulario del editor de notas, en versión web.
 *
 * Son el equivalente de los de `apps/movil/src/componentes/Formulario` (Campo,
 * Casilla, Desplegable, SelectorMarca, CampoConOpciones) pero con HTML plano y
 * las clases CSS del panel (`.campo`, `.error-campo`, etc.). La idea es que el
 * port del renglón del móvil cambie SOLO el render —misma lógica, mismos
 * nombres de prop— y no la forma de pensar el formulario.
 */

export function Campo({
  etiqueta,
  obligatorio,
  value,
  onChange,
  placeholder,
  error,
  ayuda,
  disabled,
  inputMode,
  estiloContenedor,
}: {
  etiqueta?: string
  obligatorio?: boolean
  value: string
  onChange?: (texto: string) => void
  placeholder?: string
  error?: string | null
  ayuda?: ReactNode
  disabled?: boolean
  inputMode?: 'text' | 'decimal' | 'numeric'
  estiloContenedor?: React.CSSProperties
}) {
  const id = useId()
  return (
    <div className="campo" style={estiloContenedor}>
      {etiqueta ? (
        <label htmlFor={id}>
          {etiqueta}
          {obligatorio ? ' *' : ''}
        </label>
      ) : null}
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        inputMode={inputMode}
        onChange={(e) => onChange?.(e.target.value)}
        style={error ? { borderColor: 'var(--rojo-accion)' } : undefined}
      />
      {ayuda ? <div className="donde-se-hizo">{ayuda}</div> : null}
      <MensajeError>{error}</MensajeError>
    </div>
  )
}

export function AreaTexto({
  etiqueta,
  obligatorio,
  value,
  onChange,
  placeholder,
  error,
  filas = 3,
}: {
  etiqueta?: string
  obligatorio?: boolean
  value: string
  onChange: (texto: string) => void
  placeholder?: string
  error?: string | null
  filas?: number
}) {
  const id = useId()
  return (
    <div className="campo">
      {etiqueta ? (
        <label htmlFor={id}>
          {etiqueta}
          {obligatorio ? ' *' : ''}
        </label>
      ) : null}
      <textarea
        id={id}
        value={value}
        placeholder={placeholder}
        rows={filas}
        onChange={(e) => onChange(e.target.value)}
        style={error ? { borderColor: 'var(--rojo-accion)' } : undefined}
      />
      <MensajeError>{error}</MensajeError>
    </div>
  )
}

export interface OpcionDesplegable<T extends string> {
  valor: T
  etiqueta: string
  descripcion?: string
}

export function Desplegable<T extends string>({
  etiqueta,
  obligatorio,
  marcador,
  valor,
  items,
  onChange,
  error,
  disabled,
  estiloContenedor,
}: {
  etiqueta?: string
  obligatorio?: boolean
  marcador?: string
  valor: T | null
  items: OpcionDesplegable<T>[]
  onChange: (valor: T) => void
  error?: string | null
  disabled?: boolean
  estiloContenedor?: React.CSSProperties
}) {
  const id = useId()
  const elegido = items.find((i) => i.valor === valor)
  return (
    <div className="campo" style={estiloContenedor}>
      {etiqueta ? (
        <label htmlFor={id}>
          {etiqueta}
          {obligatorio ? ' *' : ''}
        </label>
      ) : null}
      <select
        id={id}
        value={valor ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
        style={error ? { borderColor: 'var(--rojo-accion)' } : undefined}
      >
        <option value="" disabled>
          {marcador ?? 'Elegí una opción'}
        </option>
        {items.map((i) => (
          <option key={i.valor} value={i.valor}>
            {i.etiqueta}
          </option>
        ))}
      </select>
      {elegido?.descripcion ? <div className="donde-se-hizo">{elegido.descripcion}</div> : null}
      <MensajeError>{error}</MensajeError>
    </div>
  )
}

export function Casilla({
  etiqueta,
  valor,
  onChange,
}: {
  etiqueta: string
  valor: boolean
  onChange: (valor: boolean) => void
}) {
  return (
    <label
      className="campo"
      style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', textTransform: 'none' }}
    >
      <input
        type="checkbox"
        checked={valor}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 18, height: 18, minHeight: 0, flex: '0 0 auto' }}
      />
      <span style={{ fontWeight: 600, fontSize: 13 }}>{etiqueta}</span>
    </label>
  )
}

/**
 * Un campo de texto con opciones sugeridas debajo (chips).
 *
 * Es el `CampoConOpciones` del móvil: se puede tipear libre y, además, tocar una
 * de las medidas que el catálogo tiene cargadas para lo que ya se eligió.
 */
export function CampoConOpciones({
  etiqueta,
  obligatorio,
  value,
  onChange,
  opciones,
  alElegir,
  error,
  ayuda,
  placeholder,
  disabled,
  estiloContenedor,
}: {
  etiqueta?: string
  obligatorio?: boolean
  value: string
  onChange: (texto: string) => void
  opciones: { valor: string; cantidad: number }[]
  alElegir: (valor: string) => void
  error?: string | null
  ayuda?: ReactNode
  placeholder?: string
  disabled?: boolean
  estiloContenedor?: React.CSSProperties
}) {
  return (
    <div style={estiloContenedor}>
      <Campo
        etiqueta={etiqueta}
        obligatorio={obligatorio}
        value={value}
        onChange={onChange}
        error={error}
        ayuda={ayuda}
        placeholder={placeholder}
        disabled={disabled}
        inputMode="decimal"
      />
      {opciones.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: -8, marginBottom: 12 }}>
          {opciones.map((o) => {
            const activo = value.trim().replace('.', ',') === String(o.valor).replace('.', ',')
            return (
              <button
                key={o.valor}
                type="button"
                className="chico"
                onClick={() => alElegir(o.valor)}
                style={
                  activo
                    ? { background: 'var(--verde)', color: 'var(--negro)', minHeight: 28, padding: '4px 10px' }
                    : { minHeight: 28, padding: '4px 10px' }
                }
              >
                {o.valor}
                {o.cantidad > 0 ? <small style={{ opacity: 0.6 }}> ({o.cantidad})</small> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Marca de la sierra: texto libre con sugerencias (datalist). La trae el
 * cliente, así que se puede escribir una que no esté en la lista.
 */
export function SelectorMarca({
  etiqueta,
  valor,
  marcas,
  onChange,
  ayuda,
}: {
  etiqueta?: string
  valor: string | null
  marcas: string[]
  onChange: (valor: string | null) => void
  ayuda?: ReactNode
}) {
  const id = useId()
  return (
    <div className="campo">
      {etiqueta ? <label htmlFor={id}>{etiqueta}</label> : null}
      <input
        id={id}
        list={`${id}-marcas`}
        value={valor ?? ''}
        onChange={(e) => onChange(e.target.value.trim() ? e.target.value : null)}
        placeholder="Freud, Shark…"
      />
      <datalist id={`${id}-marcas`}>
        {marcas.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      {ayuda ? <div className="donde-se-hizo">{ayuda}</div> : null}
    </div>
  )
}

export function MensajeError({ children }: { children?: ReactNode }) {
  if (!children) return null
  return (
    <div className="error-campo" role="alert">
      {children}
    </div>
  )
}

export function Pastilla({ texto, color }: { texto: string; color?: string }) {
  return (
    <span className={`pastilla ${color ?? 'gris'}`} style={{ marginRight: 4 }}>
      {texto}
    </span>
  )
}

export function Aviso({
  tono = 'info',
  titulo,
  children,
}: {
  tono?: 'info' | 'exito' | 'atencion' | 'error'
  titulo?: string
  children?: ReactNode
}) {
  const clase = tono === 'info' ? 'aviso' : `aviso ${tono}`
  return (
    <div className={clase}>
      {titulo ? <strong>{titulo}</strong> : null}
      {titulo && children ? <br /> : null}
      {children}
    </div>
  )
}
