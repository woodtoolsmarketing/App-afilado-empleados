import { QueryClient } from '@tanstack/react-query'

/**
 * El cliente de React Query, en su propio módulo.
 *
 * Antes vivía adentro de `App.tsx`. Se sacó acá para que el cambio de cuenta lo
 * pueda vaciar (`clienteConsultas.clear()`): al pasar de un vendedor a otro en
 * el mismo teléfono, la caché del anterior —resúmenes, cobranzas, listas— no
 * puede quedar visible bajo la cuenta nueva mientras se re-consulta.
 */
export const clienteConsultas = new QueryClient({
  defaultOptions: {
    queries: {
      // El vendedor trabaja con señal intermitente: mejor mostrar lo último
      // que tenemos que una pantalla vacía.
      staleTime: 30_000,
      retry: 2,
      refetchOnReconnect: true,
    },
  },
})
