/**
 * Sessao do Google Drive no app.
 *
 * O refresh token (o unico segredo) vive no SecureStore; o access token fica so
 * na memoria deste modulo. No navegador nada e persistido: a sessao vale
 * enquanto a aba existir.
 *
 * O login usa o fluxo de codigo com PKCE S256: `expo-web-browser` abre a tela do
 * Google, o app recebe o code em `dyarium://oauth` e troca por tokens sem
 * client secret. O `state` e conferido antes de qualquer troca.
 */

import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';
import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { GOOGLE_SCOPES, driveConfigured, driveRedirectUri, googleClientId } from './driveConfig';

export type DriveSessionState = 'off' | 'connected' | 'expired' | 'unsupported';

export interface GoogleProfile {
  name: string;
  email: string;
  picture: string;
}

const REFRESH_KEY = 'dyarium.drive.refresh';
const CLIENT_KEY = 'dyarium.drive.client';
const PROFILE_KEY = 'dyarium.drive.profile';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/** Margem para nao entregar um token que vence durante a chamada. */
const FRESH_MS = 60_000;

interface TokenGrant {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
}

interface TokenPayload {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  error?: unknown;
}

/** O Google recusou o refresh token: a sessao acabou de verdade. */
class InvalidGrant extends Error {}

let refresh: string | null = null;
let access: { value: string; expiresAt: number } | null = null;
let expired = false;
let profile: GoogleProfile | null = null;

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // Um ouvinte com defeito nao pode impedir os outros de saber da mudanca.
    }
  }
}

/** O aviso sai no fim do turno: quem chamou pode estar no meio do render. */
function scheduleNotify(): void {
  Promise.resolve()
    .then(notify)
    .catch(() => undefined);
}

/**
 * `expo-secure-store` nao existe no navegador e, la, persistir token seria
 * exatamente o que a regra proibe. Fora do aparelho, a sessao e so memoria.
 */
function persistent(): boolean {
  return Platform.OS !== 'web';
}

async function readSecret(key: string): Promise<string | null> {
  if (!persistent()) return null;
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    // Cofre indisponivel: a sessao desta execucao segue so em memoria.
    return null;
  }
}

async function writeSecret(key: string, value: string): Promise<void> {
  if (!persistent()) return;
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    // Gravacao falhou (cofre bloqueado ou sem espaco): o refresh ainda vale
    // nesta execucao, so nao sobrevive a um reinicio.
  }
}

async function deleteSecret(key: string): Promise<void> {
  if (!persistent()) return;
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // Nada a apagar ou cofre indisponivel.
  }
}

let ready: Promise<void> | null = null;

/**
 * Le a sessao guardada uma vez por execucao. Se o client id mudou, o refresh
 * antigo nao serve mais e vai fora; sem client id configurado, o valor fica
 * guardado para quando a configuracao existir.
 */
function isValidProfile(value: unknown): value is GoogleProfile {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === 'string' &&
    typeof v.email === 'string' &&
    typeof v.picture === 'string'
  );
}

function hydrate(): Promise<void> {
  ready ??= (async () => {
    if (!persistent()) return;
    const stored = await readSecret(REFRESH_KEY);
    const current = googleClientId();
    if (stored && current !== '') {
      const usedClient = await readSecret(CLIENT_KEY);
      if (usedClient !== current) {
        await deleteSecret(REFRESH_KEY);
        await deleteSecret(CLIENT_KEY);
        await deleteSecret(PROFILE_KEY);
        refresh = null;
        profile = null;
        return;
      }
      refresh = stored;
    } else if (!stored) {
      refresh = null;
    }
    // Perfil e dado de exibicao: hidrata junto, sem quebrar se corrompido.
    const storedProfile = await readSecret(PROFILE_KEY);
    if (storedProfile) {
      try {
        const parsed = JSON.parse(storedProfile) as unknown;
        if (isValidProfile(parsed)) profile = parsed;
        else {
          profile = null;
          await deleteSecret(PROFILE_KEY);
        }
      } catch {
        profile = null;
        await deleteSecret(PROFILE_KEY);
      }
    } else {
      profile = null;
    }
    if (refresh) scheduleNotify();
  })().catch(() => undefined);
  return ready;
}

void hydrate();

function base64Url(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += alphabet[b0 >> 2];
    out += alphabet[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) out += alphabet[((b1 & 0x0f) << 2) | (b2 >> 6)];
    if (i + 2 < bytes.length) out += alphabet[b2 & 0x3f];
  }
  return out;
}

/** Le um parametro da URL de retorno sem depender do `URL` do ambiente. */
function queryParam(url: string, key: string): string | null {
  const start = url.indexOf('?');
  if (start < 0) return null;
  const hash = url.indexOf('#', start);
  const query = url.slice(start + 1, hash < 0 ? url.length : hash);
  for (const part of query.split('&')) {
    const eq = part.indexOf('=');
    let name = eq < 0 ? part : part.slice(0, eq);
    let value = eq < 0 ? '' : part.slice(eq + 1);
    try {
      name = decodeURIComponent(name);
      value = decodeURIComponent(value);
    } catch {
      continue;
    }
    if (name === key) return value;
  }
  return null;
}

/**
 * Troca codigo ou refresh token por um access token. O corpo vai em
 * `application/x-www-form-urlencoded` e nunca inclui client secret. O payload
 * de erro do Google nao vira mensagem: so o tipo de falha importa.
 */
async function requestToken(fields: Record<string, string>): Promise<TokenGrant> {
  let res: Response;
  try {
    res = await (globalThis.fetch as typeof fetch)(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    });
  } catch {
    throw new Error('nao foi possivel falar com o Google');
  }

  let payload: TokenPayload = {};
  try {
    payload = (await res.json()) as TokenPayload;
  } catch {
    payload = {};
  }

  const accessToken = typeof payload.access_token === 'string' ? payload.access_token : '';
  if (!res.ok || accessToken === '') {
    if (payload.error === 'invalid_grant') throw new InvalidGrant('invalid_grant');
    throw new Error('nao foi possivel conectar ao Google');
  }

  return {
    accessToken,
    refreshToken:
      typeof payload.refresh_token === 'string' && payload.refresh_token !== ''
        ? payload.refresh_token
        : null,
    expiresIn:
      typeof payload.expires_in === 'number' && payload.expires_in > 0
        ? payload.expires_in
        : 3600,
  };
}

function applyAccess(grant: TokenGrant): void {
  access = { value: grant.accessToken, expiresAt: Date.now() + grant.expiresIn * 1000 };
}

async function clearSession(): Promise<void> {
  refresh = null;
  access = null;
  profile = null;
  await Promise.all([deleteSecret(REFRESH_KEY), deleteSecret(CLIENT_KEY), deleteSecret(PROFILE_KEY)]);
}

export function driveSessionState(): DriveSessionState {
  if (!driveConfigured()) return 'unsupported';
  if (refresh) return 'connected';
  if (expired) return 'expired';
  return 'off';
}

/**
 * Le a sessao guardada antes de a tela decidir o que mostrar. Sem isso, a
 * primeira renderizacao acontece antes do SecureStore responder e a linha
 * aparece como "nao conectado" mesmo havendo refresh token.
 */
export function loadDriveSession(): Promise<void> {
  return hydrate();
}

export function onDriveSessionChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Abre a tela de login do Google. Precisa de gesto do usuario: o navegador
 * embutido nao abre por script.
 */
export async function connectDrive(): Promise<void> {
  if (!driveConfigured()) throw new Error('Google Drive nao configurado');
  await hydrate();

  const clientId = googleClientId();
  const verifier = base64Url(getRandomBytes(32));
  const challenge = base64Url(sha256(utf8ToBytes(verifier)));
  const state = base64Url(getRandomBytes(16));

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: driveRedirectUri(),
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  let result: WebBrowser.WebBrowserAuthSessionResult;
  try {
    result = await WebBrowser.openAuthSessionAsync(
      `${AUTH_ENDPOINT}?${params.toString()}`,
      driveRedirectUri(),
    );
  } catch {
    throw new Error('nao foi possivel abrir o login do Google');
  }

  if (result.type !== 'success') throw new Error('login do Google cancelado');
  if (queryParam(result.url, 'state') !== state) {
    throw new Error('resposta do Google invalida');
  }
  const code = queryParam(result.url, 'code');
  if (!code) throw new Error('login do Google recusado');

  const grant = await requestToken({
    client_id: clientId,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: driveRedirectUri(),
  });

  // Sem refresh token a conexao morreria em uma hora; nao vale guardar.
  if (!grant.refreshToken) throw new Error('o Google nao devolveu acesso permanente');

  refresh = grant.refreshToken;
  applyAccess(grant);
  expired = false;
  await writeSecret(REFRESH_KEY, grant.refreshToken);
  await writeSecret(CLIENT_KEY, clientId);

  // Identidade e best-effort: nunca bloqueia nem quebra o login.
  profile = null;
  await deleteSecret(PROFILE_KEY);
  try {
    const fetched = await fetchGoogleProfile(grant.accessToken);
    if (fetched) {
      profile = fetched;
      await writeSecret(PROFILE_KEY, JSON.stringify(fetched));
    }
  } catch {
    // Ignorado de proposito.
  }
  notify();
}

/**
 * Access token valido agora. Com `forceRefresh`, renova mesmo que o atual ainda
 * sirva — usado quando o Drive responde 401.
 */
export async function getDriveAccessToken(forceRefresh = false): Promise<string> {
  if (!driveConfigured()) throw new Error('Google Drive nao configurado');
  await hydrate();

  if (!forceRefresh && access && access.expiresAt - Date.now() > FRESH_MS) {
    if (!profile) {
      try {
        const fetched = await fetchGoogleProfile(access.value);
        if (fetched) {
          profile = fetched;
          await writeSecret(PROFILE_KEY, JSON.stringify(fetched));
          scheduleNotify();
        }
      } catch {
        // best-effort
      }
    }
    return access.value;
  }

  const stored = refresh;
  if (!stored) throw new Error('Drive nao conectado');

  try {
    const grant = await requestToken({
      client_id: googleClientId(),
      refresh_token: stored,
      grant_type: 'refresh_token',
    });
    applyAccess(grant);
    expired = false;
    if (grant.refreshToken && grant.refreshToken !== stored) {
      refresh = grant.refreshToken;
      await writeSecret(REFRESH_KEY, grant.refreshToken);
    }
    if (!profile) {
      try {
        const fetched = await fetchGoogleProfile(grant.accessToken);
        if (fetched) {
          profile = fetched;
          await writeSecret(PROFILE_KEY, JSON.stringify(fetched));
          scheduleNotify();
        }
      } catch {
        // best-effort
      }
    }
    return grant.accessToken;
  } catch (error) {
    if (error instanceof InvalidGrant) {
      await clearSession();
      expired = true;
      notify();
      throw new Error('a conexao com o Google expirou');
    }
    throw error;
  }
}

/**
 * Encerra a sessao. A revogacao vai no corpo do POST (nunca na URL) e uma
 * falha de rede nao impede limpar o que esta guardado aqui.
 */
/**
 * Busca a identidade do usuario no Google. Defensivo: qualquer falha vira
 * `null`, sem quebrar o login nem vazar detalhe.
 */
export async function fetchGoogleProfile(accessToken: string): Promise<GoogleProfile | null> {
  try {
    const res = await (globalThis.fetch as typeof fetch)('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    if (!data || typeof data !== 'object') return null;
    const v = data as Record<string, unknown>;
    const name = typeof v.name === 'string' ? v.name : '';
    const email = typeof v.email === 'string' ? v.email : '';
    const picture = typeof v.picture === 'string' ? v.picture : '';
    // Se nada veio, trata como falha de parse.
    if (name === '' && email === '' && picture === '') return null;
    return { name, email, picture };
  } catch {
    return null;
  }
}

/** Perfil atualmente conhecido (ou null). */
export function driveProfile(): GoogleProfile | null {
  return profile;
}

export async function disconnectDrive(): Promise<void> {
  await hydrate();
  const stored = refresh;

  if (stored) {
    try {
      await (globalThis.fetch as typeof fetch)(REVOKE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: stored }).toString(),
      });
    } catch {
      // Sem rede: o token guardado sai do aparelho do mesmo jeito e expira
      // sozinho do lado do Google.
    }
  }

  await clearSession();
  expired = false;
  notify();
}
