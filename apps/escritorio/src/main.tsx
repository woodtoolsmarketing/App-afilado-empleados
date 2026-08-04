import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'

import { App } from './App'
import './estilos.css'
import 'leaflet/dist/leaflet.css'

const consultas = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true } },
})

// HashRouter y no BrowserRouter: en producción la app se sirve desde file://,
// donde las rutas por path no resuelven.
ReactDOM.createRoot(document.getElementById('raiz')!).render(
  <React.StrictMode>
    <QueryClientProvider client={consultas}>
      <HashRouter>
        <App />
      </HashRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
