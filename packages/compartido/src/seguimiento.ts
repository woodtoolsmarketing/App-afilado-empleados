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
  /** Hora local en que arranca (0-23), inclusive. */
  desde: number
  /** Hora local en que termina (0-23), exclusive: `hasta: 17` corta a las 17:00. */
  hasta: number
  /** Días permitidos, en formato ISO: 1 = lunes … 7 = domingo. */
  dias: number[]
}

export const HORARIO_SEGUIMIENTO_DEFECTO: HorarioSeguimiento = {
  desde: 8,
  hasta: 17,
  dias: [1, 2, 3, 4, 5],
}

/** Normaliza lo que venga de `configuracion` a un HorarioSeguimiento válido. */
export function horarioSeguimientoDesde(valor: unknown): HorarioSeguimiento {
  const v = (valor ?? {}) as Partial<HorarioSeguimiento>
  const desde = Number.isInteger(v.desde) ? (v.desde as number) : HORARIO_SEGUIMIENTO_DEFECTO.desde
  const hasta = Number.isInteger(v.hasta) ? (v.hasta as number) : HORARIO_SEGUIMIENTO_DEFECTO.hasta
  const dias =
    Array.isArray(v.dias) && v.dias.length > 0
      ? v.dias.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7)
      : HORARIO_SEGUIMIENTO_DEFECTO.dias
  return {
    desde: desde >= 0 && desde <= 23 ? desde : HORARIO_SEGUIMIENTO_DEFECTO.desde,
    hasta: hasta >= 1 && hasta <= 24 ? hasta : HORARIO_SEGUIMIENTO_DEFECTO.hasta,
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
  const hora = fecha.getHours()
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
  return `${franjaDias}, de ${horario.desde} a ${horario.hasta} hs`
}
