import {
  etiquetaZona,
  numeroDeVendedorImpreso,
  VENDEDORES_CON_CERO,
  zonaParaUbicacion,
  ZONAS,
  type ClienteBuscado,
  type FormularioNotaEncabezado,
  type SucursalCliente,
  type UbicacionCliente,
} from '@woodtools/compartido'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import {
  buscarClientes,
  direccionesDeCliente,
  vendedorDeZona,
} from '../../servicios/notasPedido'
import { Aviso, Campo, Desplegable, MensajeError, Pastilla } from './Controles'

/**
 * A quién se le hace la nota (port de `PasoCliente`, recortado para EDITAR).
 *
 * La nota ya tiene cliente: no hace falta el alta de cliente nuevo ni el flujo
 * provisorio. Se muestra el cliente actual y se puede cambiar con el buscador
 * (`buscar_clientes`, con "quién manda" para que una respuesta vieja no pise la
 * nueva). Al elegir otro, la zona y —si está vacío— el número de vendedor se
 * recalculan solos; con 2+ sucursales, se elige a cuál apunta el pedido.
 */
export function SelectorCliente({
  form,
  alCambiar,
  errores,
}: {
  form: FormularioNotaEncabezado
  alCambiar: (cambios: Partial<FormularioNotaEncabezado>) => void
  errores: Record<string, string | undefined>
}) {
  const [consulta, setConsulta] = useState('')
  const [resultados, setResultados] = useState<ClienteBuscado[]>([])
  const [buscando, setBuscando] = useState(false)
  const [cambiando, setCambiando] = useState(false)
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Quién manda: sólo la última búsqueda puede escribir en pantalla. */
  const vigente = useRef(0)
  /** El cliente elegido completo, para rearmar los datos al cambiar de sucursal. */
  const clienteRef = useRef<ClienteBuscado | null>(null)

  const { data: sucursales = [] } = useQuery({
    queryKey: ['sucursales-nota', form.cliente_id],
    queryFn: () => direccionesDeCliente(form.cliente_id!),
    enabled: !!form.cliente_id,
    staleTime: 60_000,
  })

  async function buscar(texto: string) {
    const mia = ++vigente.current
    setBuscando(true)
    try {
      const encontrados = await buscarClientes(texto)
      if (mia !== vigente.current) return
      setResultados(encontrados)
    } catch {
      if (mia !== vigente.current) return
      // La lista no se vacía: si había algo bueno de antes, sigue sirviendo.
    } finally {
      if (mia === vigente.current) setBuscando(false)
    }
  }

  useEffect(() => {
    if (temporizador.current) clearTimeout(temporizador.current)
    if (consulta.trim().length < 2) {
      vigente.current++
      setResultados([])
      setBuscando(false)
      return
    }
    temporizador.current = setTimeout(() => void buscar(consulta.trim()), 350)
    return () => {
      if (temporizador.current) clearTimeout(temporizador.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consulta])

  function asignarZona(u: UbicacionCliente, forzar = false): void {
    const { unica } = zonaParaUbicacion(u)
    if (!unica) return
    if (form.zona && !forzar) return
    alCambiar({ zona: unica.zona.codigo, zona_id: unica.zona.id })
  }

  function elegirCliente(c: ClienteBuscado) {
    vigente.current++
    if (temporizador.current) clearTimeout(temporizador.current)
    setBuscando(false)
    setResultados([])
    setConsulta('')
    setCambiando(false)

    const datos = [
      c.razon_social,
      c.direccion,
      c.codigo_postal ? `CP ${c.codigo_postal}` : null,
      c.telefono ? `Tel ${c.telefono}` : null,
      c.email,
      c.contacto_nombre ? `Contacto: ${c.contacto_nombre}` : null,
    ]
      .filter(Boolean)
      .join(' — ')

    clienteRef.current = c

    alCambiar({
      cliente_id: c.cliente_id,
      cliente_codigo: c.codigo,
      cliente_nombre: c.razon_social,
      cliente_cuit: c.cuit ?? '',
      cliente_provisorio: c.provisorio,
      direccion_id: c.direccion_id,
      cliente_provincia: c.provincia ?? '',
      // Al cambiar de cliente los datos se rearman con su ficha (acá no se
      // preserva lo tipeado: es un cambio de cliente, no una corrección de texto).
      datos_cliente: datos,
    })

    // Es la ubicación la que manda: la zona se recalcula sobre el cliente nuevo.
    asignarZona({ localidad: c.localidad, provincia: c.provincia, direccion: c.direccion }, true)

    // El número de vendedor, si quedó vacío: lo cubre el de la zona.
    if (!form.vendedor_numero.trim() && c.localidad) {
      const { unica } = zonaParaUbicacion({ localidad: c.localidad, provincia: c.provincia })
      if (unica) {
        void vendedorDeZona(unica.zona.codigo).then((codigo) => {
          if (codigo) alCambiar({ vendedor_numero: codigo })
        })
      }
    }
  }

  function elegirSucursalNota(s: SucursalCliente) {
    const c = clienteRef.current
    const datos = [
      c?.razon_social ?? form.cliente_nombre,
      s.direccion_formateada,
      s.codigo_postal ? `CP ${s.codigo_postal}` : null,
      c?.telefono ? `Tel ${c.telefono}` : null,
      c?.email,
      c?.contacto_nombre ? `Contacto: ${c.contacto_nombre}` : null,
    ]
      .filter(Boolean)
      .join(' — ')

    alCambiar({
      direccion_id: s.id,
      datos_cliente: datos,
      cliente_provincia: s.provincia ?? form.cliente_provincia,
    })

    asignarZona(
      { localidad: s.localidad, provincia: s.provincia, direccion: s.direccion_formateada },
      true,
    )
  }

  const vendedorImpreso =
    form.vendedor_numero &&
    numeroDeVendedorImpreso(form.vendedor_numero, VENDEDORES_CON_CERO) !== form.vendedor_numero
      ? `En la nota sale: ${numeroDeVendedorImpreso(form.vendedor_numero, VENDEDORES_CON_CERO)}`
      : undefined

  return (
    <div>
      {/* El cliente actual, con el botón para cambiarlo. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          border: '2px solid var(--verde-oscuro)',
          borderRadius: 'var(--radio)',
          background: 'var(--blanco)',
          padding: '10px 12px',
          marginBottom: 14,
        }}
      >
        <span style={{ color: 'var(--verde-oscuro)', fontWeight: 800 }}>✓</span>
        <span style={{ fontWeight: 700, flex: 1 }}>
          {form.cliente_provisorio ? 'Nuevo cliente' : form.cliente_codigo || 'Sin código'} ·{' '}
          {form.cliente_nombre || 'Sin cliente'}
        </span>
        <button type="button" className="chico" onClick={() => setCambiando((v) => !v)}>
          {cambiando ? 'Cerrar' : 'Cambiar cliente'}
        </button>
      </div>

      {cambiando ? (
        <div
          style={{
            border: '2px solid var(--negro)',
            borderRadius: 'var(--radio)',
            background: 'var(--panel-claro)',
            padding: 12,
            marginBottom: 14,
          }}
        >
          <Campo
            etiqueta="Buscar por código, nombre o CUIT"
            value={consulta}
            onChange={setConsulta}
            placeholder="Código, razón social o CUIT…"
            ayuda={buscando ? 'Buscando…' : undefined}
          />
          {resultados.length > 0 ? (
            <div
              style={{
                border: '2px solid var(--negro)',
                borderRadius: 'var(--radio)',
                background: 'var(--blanco)',
                overflow: 'hidden',
                maxHeight: 280,
                overflowY: 'auto',
              }}
            >
              {resultados.map((c) => (
                <button
                  key={c.cliente_id}
                  type="button"
                  onClick={() => elegirCliente(c)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    border: 'none',
                    borderBottom: '1px solid var(--panel-oscuro)',
                    borderRadius: 0,
                    background: 'none',
                    padding: '8px 12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 700, color: 'var(--rojo)' }}>{c.codigo}</span>
                    {c.provisorio ? <Pastilla texto="PROVISORIO" color="ambar" /> : null}
                  </div>
                  <div style={{ fontWeight: 700 }}>{c.razon_social}</div>
                  {c.direccion ? (
                    <div style={{ fontSize: 12, color: 'var(--tinta-suave)' }}>{c.direccion}</div>
                  ) : null}
                  {c.cuit ? (
                    <div style={{ fontSize: 12, color: 'var(--tinta-suave)' }}>CUIT {c.cuit}</div>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <MensajeError>{errores.cliente}</MensajeError>

      <div className="fila">
        <Campo
          etiqueta="Nombre o razón social"
          obligatorio
          value={form.cliente_nombre}
          onChange={(t) => alCambiar({ cliente_nombre: t })}
          error={errores.cliente_nombre}
          estiloContenedor={{ marginBottom: 14, flex: 2 }}
        />
        <Campo
          etiqueta="CUIT"
          value={form.cliente_cuit}
          onChange={(t) => alCambiar({ cliente_cuit: t })}
          placeholder="30-12345678-9"
          estiloContenedor={{ marginBottom: 14 }}
        />
      </div>

      <div className="fila">
        <Campo
          etiqueta="Vendedor Nº"
          obligatorio
          value={form.vendedor_numero}
          onChange={(t) => alCambiar({ vendedor_numero: t.replace(/\D/g, '').slice(0, 4) })}
          placeholder="7"
          inputMode="numeric"
          error={errores.vendedor_numero}
          ayuda={vendedorImpreso}
          estiloContenedor={{ marginBottom: 14 }}
        />
        <Desplegable<string>
          etiqueta="Zona"
          obligatorio
          marcador="Elegí la zona"
          valor={form.zona_id || null}
          items={ZONAS.map((z) => ({
            valor: z.id,
            etiqueta: etiquetaZona(z),
            descripcion: z.localidades.slice(0, 4).join(', '),
          }))}
          onChange={(id) => {
            const zona = ZONAS.find((z) => z.id === id)
            if (zona) alCambiar({ zona: zona.codigo, zona_id: zona.id })
          }}
          error={errores.zona}
          estiloContenedor={{ marginBottom: 14 }}
        />
      </div>

      {form.cliente_provisorio ? (
        <Aviso tono="atencion" titulo="Cliente provisorio">
          Todavía sin código definitivo. La nota queda sin número hasta que Administración se lo
          asigne.
        </Aviso>
      ) : null}

      {form.cliente_id && sucursales.length >= 2 ? (
        <Desplegable<string>
          etiqueta="¿A qué sucursal?"
          valor={form.direccion_id}
          items={sucursales.map((s) => ({
            valor: s.id,
            etiqueta: s.principal ? 'Principal' : s.etiqueta,
            descripcion: s.direccion_formateada,
          }))}
          onChange={(id) => {
            const s = sucursales.find((x) => x.id === id)
            if (s) elegirSucursalNota(s)
          }}
        />
      ) : null}

      <div className="campo">
        <label htmlFor="datos-cliente">Datos del cliente *</label>
        <textarea
          id="datos-cliente"
          rows={3}
          value={form.datos_cliente}
          onChange={(e) => alCambiar({ datos_cliente: e.target.value, datos_cliente_origen: 'texto' })}
          placeholder="Dirección, teléfono, contacto…"
          style={errores.datos_cliente ? { borderColor: 'var(--rojo-accion)' } : undefined}
        />
        <MensajeError>{errores.datos_cliente}</MensajeError>
      </div>
    </div>
  )
}
