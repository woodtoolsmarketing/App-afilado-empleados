const { getDefaultConfig } = require('expo/metro-config')
const path = require('node:path')

// El proyecto es un monorepo con workspaces: Metro tiene que mirar la raíz para
// resolver `@woodtools/compartido`, que vive fuera de apps/movil.
const raizProyecto = __dirname
const raizMonorepo = path.resolve(raizProyecto, '../..')

const config = getDefaultConfig(raizProyecto)

config.watchFolders = [raizMonorepo]
config.resolver.nodeModulesPaths = [
  path.resolve(raizProyecto, 'node_modules'),
  path.resolve(raizMonorepo, 'node_modules'),
]
config.resolver.disableHierarchicalLookup = true

module.exports = config
