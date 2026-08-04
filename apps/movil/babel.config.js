module.exports = function (api) {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // react-native-reanimated tiene que ir SIEMPRE último en la lista.
      'react-native-reanimated/plugin',
    ],
  }
}
