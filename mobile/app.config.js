/**
 * Configuracao do Expo.
 *
 * O `app.json` continua sendo a fonte unica da versao e das opcoes do app. Este
 * arquivo so entra para o build de emulador: o APK normal e arm64 (o aparelho),
 * e o emulador x86_64 precisa da ABI x86_64. Sem `DYARIUM_EMULATOR=1`, a
 * configuracao devolvida e exatamente a do `app.json`.
 */
const appJson = require('./app.json');

module.exports = () => {
  const expo = JSON.parse(JSON.stringify(appJson.expo));
  if (process.env.DYARIUM_EMULATOR !== '1') return expo;

  const buildProperties = expo.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties',
  );
  if (buildProperties) {
    buildProperties[1].android = {
      ...buildProperties[1].android,
      buildArchs: ['x86_64'],
    };
  }
  return expo;
};
