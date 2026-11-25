/**
 * Configuracao do Google Drive no app.
 *
 * O client id e publico por natureza (vai no bundle): o que nao pode faltar e
 * ele estar configurado em `EXPO_PUBLIC_GOOGLE_*_CLIENT_ID`. O segredo da
 * sessao e o refresh token, que fica so no SecureStore.
 *
 * Cada plataforma tem o seu client id porque o Google amarra o app ao pacote e
 * a assinatura; o navegador usa o client id web.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { driveRedirectUriFor } from '@/core/driveRedirect';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export const GOOGLE_SCOPES = [DRIVE_SCOPE, 'openid', 'email', 'profile'].join(' ');

/** Valor que veio no binario nativo (app.config.js), independente do Metro. */
function extraClientId(key: string): string {
  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
  const value = extra?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function googleClientId(): string {
  // Leitura estatica: o Expo troca `process.env.EXPO_PUBLIC_*` pelo valor no
  // bundle. Acesso dinamico nao e substituido e chega vazio no aparelho.
  const value =
    Platform.OS === 'web'
      ? process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
      : Platform.OS === 'ios'
        ? process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
        : process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
  const inline = (value ?? '').trim();
  if (inline) return inline;
  return extraClientId(
    Platform.OS === 'web'
      ? 'googleWebClientId'
      : Platform.OS === 'ios'
        ? 'googleIosClientId'
        : 'googleAndroidClientId',
  );
}

/** Ha client id para esta plataforma? Sem ele a tela nem oferece o login. */
export function driveConfigured(): boolean {
  return googleClientId().length > 0;
}

/**
 * Retorno do login. No aparelho e o esquema do proprio client id, que e o que
 * o Google aceita como redirect de app instalado; no navegador fica o
 * marcador do app web de desenvolvimento.
 */
export function driveRedirectUri(): string {
  return driveRedirectUriFor(Platform.OS, googleClientId());
}
