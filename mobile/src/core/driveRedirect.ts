/**
 * Redirect do login Google para app instalado.
 *
 * O Google recusa esquema sem ponto e espera, para app nativo, o esquema
 * derivado do client id: `com.googleusercontent.apps.<numero>://oauthredirect`.
 * Puro para poder ser testado sem React Native nem Expo.
 */

const CLIENT_SUFFIX = '.apps.googleusercontent.com';
export const FALLBACK_REDIRECT = 'dyarium://oauth';

export function reverseClientScheme(clientId: string): string | null {
  const id = clientId.trim();
  if (!id) return null;
  const numeric = id.endsWith(CLIENT_SUFFIX) ? id.slice(0, -CLIENT_SUFFIX.length) : id;
  if (!numeric || numeric.includes(':') || numeric.includes('/')) return null;
  return `com.googleusercontent.apps.${numeric}`;
}

export function driveRedirectUriFor(platform: string, clientId: string): string {
  if (platform === 'web') return FALLBACK_REDIRECT;
  const scheme = reverseClientScheme(clientId);
  return scheme ? `${scheme}://oauthredirect` : FALLBACK_REDIRECT;
}
