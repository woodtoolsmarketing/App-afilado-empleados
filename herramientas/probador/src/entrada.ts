import { arrancar } from './app'
import { ESTILOS } from './ui'

const hoja = document.createElement('style')
hoja.textContent = ESTILOS
document.head.appendChild(hoja)

void arrancar()
