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
  return path;
}
