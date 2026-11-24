/**
 * Redireciona o deep link disparado quando outro app compartilha um audio com o
 * dyarium (expo-sharing) para a tela de revisao. Ver:
 * https://docs.expo.dev/router/advanced/native-intent/
 */
export async function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): Promise<string> {
  // Deep link do expo-sharing: <scheme>://expo-sharing/...
  if (/:\/\/expo-sharing(\/|$|\?)/.test(path)) return '/import';
  // Volta do login do Google: o codigo e consumido pelo Linking/WebBrowser;
  // a rota nao deve cair num 404.
  if (/oauthredirect/.test(path)) return '/drive';
  return path;
}
