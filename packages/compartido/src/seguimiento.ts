/**
 * Horario en que se rastrea la ubicación de los vendedores.
 *
 * Dentro de esta franja la app reporta la posición y el panel la muestra en el
 * mapa en vivo. Fuera de ella no se rastrea a nadie y el panel no muestra a
 * nadie. La oficina lo puede cambiar sin recompilar desde la clave
 * `seguimiento_horario` de `configuracion`; si no está, rige el default.
 *
 * El teléfono del vendedor y la PC de la oficina están en la misma zona horaria
 * (Argentina), así que la hora LOCAL de cada uno alcanza para decidir.
 */
export interface HorarioSeguimiento {
  /** Hora local en que arranca, inclusive. Admite media hora en decimal: `7.5` = 7:30. */
  desde: number
  /** Hora local en que termina, exclusive: `hasta: 17` corta a las 17:00. Decimal, como `desde`. */
  hasta: number
  /** Días permitidos, en formato ISO: 1 = lunes … 7 = domingo. */
  dias: number[]
}

export const HORARIO_SEGUIMIENTO_DEFECTO: HorarioSeguimiento = {
  desde: 8,
  hasta: 17,
  dias: [1, 2, 3, 4, 5],
}

/**
 * Normaliza lo que venga de `configuracion` a un HorarioSeguimiento válido.
 *
 * `desde`/`hasta` admiten media hora en decimal (7.5 = 7:30). Un cliente VIEJO
 * (que exigía enteros) lee un `7.5` como inválido y cae al default 8: no rompe,
 * sigue como antes hasta que se actualice; el nuevo sí respeta el 7:30.
 */
export function horarioSeguimientoDesde(valor: unknown): HorarioSeguimiento {
  const v = (valor ?? {}) as Partial<HorarioSeguimiento>
  const esNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
  const desde = esNum(v.desde) ? (v.desde as number) : HORARIO_SEGUIMIENTO_DEFECTO.desde
  const hasta = esNum(v.hasta) ? (v.hasta as number) : HORARIO_SEGUIMIENTO_DEFECTO.hasta
  const dias =
    Array.isArray(v.dias) && v.dias.length > 0
      ? v.dias.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7)
      : HORARIO_SEGUIMIENTO_DEFECTO.dias
  return {
    desde: desde >= 0 && desde < 24 ? desde : HORARIO_SEGUIMIENTO_DEFECTO.desde,
    hasta: hasta > 0 && hasta <= 24 ? hasta : HORARIO_SEGUIMIENTO_DEFECTO.hasta,
    dias: dias.length > 0 ? dias : HORARIO_SEGUIMIENTO_DEFECTO.dias,
  }
}

/**
 * ¿La fecha (en hora LOCAL) cae dentro del horario de seguimiento?
 */
export function enHorarioDeSeguimiento(
  fecha: Date,
  horario: HorarioSeguimiento = HORARIO_SEGUIMIENTO_DEFECTO,
): boolean {
  const diaJS = fecha.getDay() // 0 = domingo … 6 = sábado
  const diaISO = diaJS === 0 ? 7 : diaJS
  if (!horario.dias.includes(diaISO)) return false
  // En decimal, para que `desde: 7.5` (7:30) compare bien a nivel minuto.
  const hora = fecha.getHours() + fecha.getMinutes() / 60
  return hora >= horario.desde && hora < horario.hasta
}

/** Texto legible del horario, p. ej. "lunes a viernes, de 8 a 17 hs". */
export function describirHorarioSeguimiento(
  horario: HorarioSeguimiento = HORARIO_SEGUIMIENTO_DEFECTO,
): string {
  const nombres = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
  const dias = [...horario.dias].sort((a, b) => a - b)
  let franjaDias: string
  if (dias.length === 0) franjaDias = 'ningún día'
  else if (dias.length === 7) franjaDias = 'todos los días'
  else if (dias.length === 1) franjaDias = nombres[dias[0]]
  else {
    const consecutiva = dias.every((d, i) => i === 0 || d === dias[i - 1] + 1)
    franjaDias = consecutiva
      ? `${nombres[dias[0]]} a ${nombres[dias[dias.length - 1]]}`
      : dias.map((d) => nombres[d]).join(', ')
  }
  return `${franjaDias}, de ${formatearHora(horario.desde)} a ${formatearHora(horario.hasta)} hs`
}

/** `7` → "7", `7.5` → "7:30", `17` → "17". Para el texto del horario. */
function formatearHora(h: number): string {
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  return mm === 0 ? `${hh}` : `${hh}:${String(mm).padStart(2, '0')}`
}
