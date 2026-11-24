/**
 * Configuracao do Expo.
 *
 * O `app.json` continua sendo a fonte unica da versao e das opcoes do app. Este
 * arquivo so entra para o build de emulador: o APK normal e arm64 (o aparelho),
 * e o emulador x86_64 precisa da ABI x86_64. Sem `DYARIUM_EMULATOR=1`, a
 * configuracao devolvida e exatamente a do `app.json`.
 */
const appJson = require('./app.json');

/**
 * O login do Google devolve o codigo para um esquema do proprio client:
 * `com.googleusercontent.apps.<numero>://oauthredirect`. Sem esse esquema o
 * Android nao abre o app de volta depois do consentimento. O valor do client
 * id nao e segredo; ele so precisa entrar no build como variavel publica.
 */
function googleSchemes() {
  const ids = [
    process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  ];
  const schemes = [];
  for (const raw of ids) {
    const id = (raw ?? '').trim();
    if (!id) continue;
    const prefix = id.endsWith('.apps.googleusercontent.com')
      ? id.slice(0, -'.apps.googleusercontent.com'.length)
      : id;
    if (prefix) schemes.push(`com.googleusercontent.apps.${prefix}`);
  }
  return schemes;
}

module.exports = () => {
  const expo = JSON.parse(JSON.stringify(appJson.expo));
  const existing = Array.isArray(expo.scheme) ? expo.scheme : [expo.scheme ?? 'dyarium'];
  expo.scheme = [...new Set([...existing, ...googleSchemes()])];
  // O client id viaja no binario nativo (extra), entao um Metro sem .env.local
  // ainda encontra o valor. O esquema de retorno ja foi montado acima.
  expo.extra = {
    ...(expo.extra ?? {}),
    googleAndroidClientId: (process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ?? '').trim(),
    googleIosClientId: (process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '').trim(),
    googleWebClientId: (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '').trim(),
    sentryDsn: (process.env.EXPO_PUBLIC_SENTRY_DSN ?? '').trim(),
  };
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
