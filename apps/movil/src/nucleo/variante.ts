import Constants from 'expo-constants'

/**
 * Qué versión de la app es ésta.
 *
 * Las tres son apps distintas para Android —tienen `package` propio— así que
 * se pueden instalar juntas en el mismo teléfono sin pisarse, y cada una guarda
 * sus datos por separado. Eso es lo que permite probar sin arriesgar lo que el
 * vendedor ya tiene cargado.
 *
 *   produccion  la que se reparte.
 *   interno     la de siempre, para probar contra el Supabase de verdad.
 *   beta        igual que la interna, pero el cliente se carga a mano.
 */
export type Variante = 'produccion' | 'interno' | 'beta'

export const VARIANTE: Variante =
  (Constants.expoConfig?.extra?.variante as Variante | undefined) ?? 'interno'

/**
 * En la beta, el cliente NO se busca en la base: se escribe entero.
 *
 * Es a propósito y temporal. Sirve para poder usar la app mientras el padrón de
 * clientes todavía no está cargado o no es confiable: el vendedor tipea código,
 * nombre y CUIT como los tiene en el papel, y la nota sale igual.
 *
 * Lo que se pierde con eso —y hay que tenerlo presente— es todo lo que la
 * ficha del cliente traía sola: la dirección, el teléfono, y sobre todo la
 * zona, que hasta ahora se asignaba mirando la localidad. En la beta la zona se
 * elige del desplegable, a mano.
 */
export const CLIENTE_A_MANO = VARIANTE === 'beta'
