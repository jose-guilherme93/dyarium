/**
 * Login do Google no app: PKCE S256, state conferido, refresh token so no
 * SecureStore e access token so em memoria. Nada de token, code, state ou URL
 * em log.
 */

import { sha256 } from '@noble/hashes/sha256';
import { Platform } from 'react-native';

type AuthModule = typeof import('../driveAuth');

const REFRESH_KEY = 'dyarium.drive.refresh';
const CLIENT_KEY = 'dyarium.drive.client';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

const mockOpenAuth = jest.fn();
const mockSecret = new Map<string, string>();
const mockConfig = { clientId: 'client-1' };
const mockGetRandomBytes = jest.fn((count: number) => new Uint8Array(count).fill(7));
const mockPlatform = { OS: 'ios' as typeof Platform.OS };

jest.mock('react-native', () => ({ Platform: mockPlatform }));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: (url: string, redirect?: string) => mockOpenAuth(url, redirect),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: (key: string) => Promise.resolve(mockSecret.get(key) ?? null),
  setItemAsync: (key: string, value: string) => {
    mockSecret.set(key, value);
    return Promise.resolve();
  },
  deleteItemAsync: (key: string) => {
    mockSecret.delete(key);
    return Promise.resolve();
  },
}));

jest.mock('expo-crypto', () => ({
  getRandomBytes: (count: number) => mockGetRandomBytes(count),
}));

jest.mock('../driveConfig', () => ({
  DRIVE_SCOPE: 'https://www.googleapis.com/auth/drive.file',
  GOOGLE_SCOPES: 'https://www.googleapis.com/auth/drive.file openid email profile',
  googleClientId: () => mockConfig.clientId,
  driveConfigured: () => mockConfig.clientId !== '',
  driveRedirectUri: () => 'dyarium://oauth',
}));

function installFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
): jest.Mock {
  const fn = jest.fn(handler);
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

function tokenResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => '',
  } as unknown as Response;
}

/** Modulo novo a cada teste: sessao e estado de modulo. */
function freshAuth(os: typeof Platform.OS = mockPlatform.OS): AuthModule {
  mockPlatform.OS = os;
  let mod: AuthModule | null = null;
  jest.resetModules();
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../driveAuth') as AuthModule;
  });
  return mod as unknown as AuthModule;
}

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

/** Abre o navegador com o state correto e troca o code por tokens. */
function authorize(accessToken = 'access-1', refreshToken: string | null = 'refresh-1'): void {
  mockOpenAuth.mockImplementationOnce(async (url: string) => {
    const state = new URL(url).searchParams.get('state');
    return { type: 'success', url: `dyarium://oauth?state=${state}&code=code-1` };
  });
  installFetch(async () =>
    tokenResponse({
      access_token: accessToken,
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
      expires_in: 3600,
    }),
  );
}

beforeEach(() => {
  mockSecret.clear();
  mockConfig.clientId = 'client-1';
  mockPlatform.OS = 'ios';
  mockOpenAuth.mockReset();
  mockGetRandomBytes.mockClear();
  delete (globalThis as unknown as { fetch?: typeof fetch }).fetch;
});

afterEach(() => {
  jest.restoreAllMocks();
  delete (globalThis as unknown as { fetch?: typeof fetch }).fetch;
});

describe('connectDrive', () => {
  it('usa PKCE S256, confere o state e guarda so o refresh', async () => {
    const auth = freshAuth();
    let opened: URL | null = null;
    const fetchMock = installFetch(async (url, init) => {
      expect(url).toBe(TOKEN_ENDPOINT);
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code')).toBe('code-1');
      expect(body.get('redirect_uri')).toBe('dyarium://oauth');
      expect(body.get('client_id')).toBe('client-1');
      expect(body.has('client_secret')).toBe(false);
      const verifier = body.get('code_verifier') ?? '';
      const challenge = base64Url(sha256(new TextEncoder().encode(verifier)));
      expect(challenge).toBe(opened?.searchParams.get('code_challenge'));
      return tokenResponse({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_in: 3600,
      });
    });
    mockOpenAuth.mockImplementationOnce(async (url: string) => {
      opened = new URL(url);
      const state = opened.searchParams.get('state');
      return { type: 'success', url: `dyarium://oauth?state=${state}&code=code-1` };
    });

    await auth.connectDrive();

    const query = (opened as URL | null)?.searchParams;
    expect(query?.get('response_type')).toBe('code');
    expect(query?.get('access_type')).toBe('offline');
    expect(query?.get('prompt')).toBe('consent');
    expect(query?.get('include_granted_scopes')).toBe('true');
    expect(query?.get('scope')).toBe('https://www.googleapis.com/auth/drive.file openid email profile');
    expect(query?.get('redirect_uri')).toBe('dyarium://oauth');
    expect(query?.get('code_challenge_method')).toBe('S256');
    expect(query?.get('code_challenge')).toBeTruthy();
    expect(query?.get('state')).toBeTruthy();
    expect((opened as URL | null)?.toString().startsWith(AUTH_ENDPOINT)).toBe(true);

    expect(mockSecret.get(REFRESH_KEY)).toBe('refresh-1');
    expect(mockSecret.get(CLIENT_KEY)).toBe('client-1');
    expect([...mockSecret.values()]).not.toContain('access-1');
    expect(auth.driveSessionState()).toBe('connected');
    await expect(auth.getDriveAccessToken()).resolves.toBe('access-1');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('recusa state diferente sem falar com o endpoint de token', async () => {
    const auth = freshAuth();
    const fetchMock = installFetch(async () => tokenResponse({}));
    mockOpenAuth.mockResolvedValueOnce({
      type: 'success',
      url: 'dyarium://oauth?state=outro&code=code-1',
    });

    await expect(auth.connectDrive()).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSecret.size).toBe(0);
    expect(auth.driveSessionState()).toBe('off');
  });

  it('cancelar a janela nao grava nada', async () => {
    const auth = freshAuth();
    const fetchMock = installFetch(async () => tokenResponse({}));
    mockOpenAuth.mockResolvedValueOnce({ type: 'cancel' });

    await expect(auth.connectDrive()).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSecret.size).toBe(0);
  });

  it('sem refresh token do Google, falha com mensagem generica', async () => {
    const auth = freshAuth();
    authorize('access-1', null);

    await expect(auth.connectDrive()).rejects.toThrow();
    expect(mockSecret.size).toBe(0);
    expect(auth.driveSessionState()).toBe('off');
  });

  it('no navegador mantem a sessao so em memoria', async () => {
    const auth = freshAuth('web');
    authorize();

    await auth.connectDrive();

    expect(mockSecret.size).toBe(0);
    expect(auth.driveSessionState()).toBe('connected');
    await expect(auth.getDriveAccessToken()).resolves.toBe('access-1');
  });

  it('avisa os ouvintes quando a sessao muda', async () => {
    const auth = freshAuth();
    const changes = jest.fn();
    const off = auth.onDriveSessionChange(changes);
    authorize();

    await auth.connectDrive();
    expect(changes).toHaveBeenCalledTimes(1);

    off();
    await auth.disconnectDrive();
    expect(changes).toHaveBeenCalledTimes(1);
  });
});

describe('getDriveAccessToken', () => {
  it('renova pelo refresh token guardado e usa o client id atual', async () => {
    mockSecret.set(REFRESH_KEY, 'refresh-old');
    mockSecret.set(CLIENT_KEY, 'client-1');
    const auth = freshAuth();
    const fetchMock = installFetch(async (url, init) => {
      expect(url).toBe(TOKEN_ENDPOINT);
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('refresh-old');
      expect(body.get('client_id')).toBe('client-1');
      expect(body.has('client_secret')).toBe(false);
      return tokenResponse({ access_token: 'access-2', expires_in: 1800 });
    });

    await expect(auth.getDriveAccessToken()).resolves.toBe('access-2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth.driveSessionState()).toBe('connected');
    expect(mockSecret.get(REFRESH_KEY)).toBe('refresh-old');
    expect([...mockSecret.values()]).not.toContain('access-2');
  });

  it('invalid_grant limpa a sessao e marca expired', async () => {
    mockSecret.set(REFRESH_KEY, 'refresh-old');
    mockSecret.set(CLIENT_KEY, 'client-1');
    const auth = freshAuth();
    const changes = jest.fn();
    auth.onDriveSessionChange(changes);
    installFetch(async () => tokenResponse({ error: 'invalid_grant' }, 400));

    await expect(auth.getDriveAccessToken()).rejects.toThrow();
    expect(auth.driveSessionState()).toBe('expired');
    expect(mockSecret.has(REFRESH_KEY)).toBe(false);
    expect(mockSecret.has(CLIENT_KEY)).toBe(false);
    expect(changes).toHaveBeenCalled();
  });

  it('a sessao vencida sobrevive ao reinicio do app', async () => {
    mockSecret.set(REFRESH_KEY, 'refresh-old');
    mockSecret.set(CLIENT_KEY, 'client-1');
    const auth = freshAuth();
    installFetch(async () => tokenResponse({ error: 'invalid_grant' }, 400));
    await expect(auth.getDriveAccessToken()).rejects.toThrow();

    const restarted = freshAuth();
    await restarted.loadDriveSession();
    expect(restarted.driveSessionState()).toBe('expired');
    expect(restarted.driveProfile()).toBeNull();
  });

  it('descarta o refresh quando o client id mudou', async () => {
    mockSecret.set(REFRESH_KEY, 'refresh-old');
    mockSecret.set(CLIENT_KEY, 'client-velho');
    mockConfig.clientId = 'client-novo';
    const auth = freshAuth();
    const fetchMock = installFetch(async () => tokenResponse({ access_token: 'nao-usado' }));

    await expect(auth.getDriveAccessToken()).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSecret.has(REFRESH_KEY)).toBe(false);
  });

  it('sem client id configurado, o estado e unsupported e nada estoura', async () => {
    mockConfig.clientId = '';
    const auth = freshAuth();

    expect(auth.driveSessionState()).toBe('unsupported');
    await expect(auth.connectDrive()).rejects.toThrow();
    await expect(auth.getDriveAccessToken()).rejects.toThrow();
  });
});

describe('disconnectDrive', () => {
  it('limpa a sessao local sem revogar a concessao Google', async () => {
    const auth = freshAuth();
    authorize();
    await auth.connectDrive();

    const fetchMock = installFetch(async () => tokenResponse({}, 200));
    await auth.disconnectDrive();

    // Revogar aqui derrubaria a sessao dos outros clientes; o sair e local.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSecret.size).toBe(0);
    expect(auth.driveSessionState()).toBe('off');
    await expect(auth.getDriveAccessToken()).rejects.toThrow();
  });
});

describe('sigilo', () => {
  it('nao loga token, code, state nem URL do Google', async () => {
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => undefined),
    );
    const auth = freshAuth();
    authorize();
    await auth.connectDrive();
    installFetch(async () => tokenResponse({ access_token: 'access-9', expires_in: 60 }));
    await auth.getDriveAccessToken(true);
    installFetch(async () => tokenResponse({}, 200));
    await auth.disconnectDrive();

    const printed = spies
      .flatMap((spy) => spy.mock.calls.flat().map((value) => String(value)))
      .join(' ');
    expect(printed).not.toMatch(/access-|refresh-|code-1|accounts\.google\.com|oauth2/);
  });
});

describe('perfil Google', () => {
  it('fetchGoogleProfile sucesso e falha', async () => {
    const auth = freshAuth();
    installFetch(async () =>
      tokenResponse({ name: 'Ana', email: 'a@b.com', picture: 'pic' }),
    );
    await expect(auth.fetchGoogleProfile('tok')).resolves.toEqual({
      name: 'Ana',
      email: 'a@b.com',
      picture: 'pic',
    });

    installFetch(async () => tokenResponse({}, 400));
    await expect(auth.fetchGoogleProfile('tok')).resolves.toBeNull();
  });

  it('connectDrive persiste o perfil e driveProfile devolve apos hidratacao', async () => {
    const auth = freshAuth();
    mockOpenAuth.mockImplementationOnce(async (url: string) => {
      const state = new URL(url).searchParams.get('state');
      return { type: 'success', url: `dyarium://oauth?state=${state}&code=code-1` };
    });
    installFetch(async (url: string) => {
      if (url === TOKEN_ENDPOINT) {
        return tokenResponse({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 3600,
        });
      }
      return tokenResponse({ name: 'Ana', email: 'a@b.com', picture: 'pic' });
    });

    await auth.connectDrive();
    expect(auth.driveProfile()).toEqual({ name: 'Ana', email: 'a@b.com', picture: 'pic' });

    const hydrated = freshAuth();
    await hydrated.loadDriveSession();
    expect(hydrated.driveProfile()).toEqual({ name: 'Ana', email: 'a@b.com', picture: 'pic' });
  });

  it('a renovacao do token tambem busca e persiste o perfil', async () => {
    mockSecret.set(REFRESH_KEY, 'refresh-old');
    mockSecret.set(CLIENT_KEY, 'client-1');
    const auth = freshAuth();
    const calls: string[] = [];
    installFetch(async (url: string) => {
      calls.push(url);
      if (url === TOKEN_ENDPOINT) return tokenResponse({ access_token: 'access-2', expires_in: 1800 });
      return tokenResponse({ name: 'Ana', email: 'a@b.com', picture: 'pic' });
    });

    await auth.loadDriveSession();
    expect(auth.driveProfile()).toBeNull();
    await expect(auth.getDriveAccessToken()).resolves.toBe('access-2');
    expect(calls).toContain('https://www.googleapis.com/oauth2/v3/userinfo');
    expect(auth.driveProfile()).toEqual({ name: 'Ana', email: 'a@b.com', picture: 'pic' });

    const restarted = freshAuth();
    await restarted.loadDriveSession();
    expect(restarted.driveProfile()).toEqual({ name: 'Ana', email: 'a@b.com', picture: 'pic' });
  });

  it('sem consentimento de email/perfil o login continua e as iniciais aparecem', async () => {
    const auth = freshAuth();
    mockOpenAuth.mockImplementationOnce(async (url: string) => {
      const state = new URL(url).searchParams.get('state');
      return { type: 'success', url: `dyarium://oauth?state=${state}&code=code-1` };
    });
    installFetch(async (url: string) => {
      if (url === TOKEN_ENDPOINT) {
        return tokenResponse({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 3600,
        });
      }
      // userinfo sem name/email/picture: o escopo `profile`/`email` foi negado.
      return tokenResponse({ sub: '123' });
    });

    await expect(auth.connectDrive()).resolves.toBeUndefined();
    expect(auth.driveSessionState()).toBe('connected');
    expect(auth.driveProfile()).toBeNull();
    expect(mockSecret.get(REFRESH_KEY)).toBe('refresh-1');
    expect(mockSecret.has('dyarium.drive.profile')).toBe(false);
  });

  it('disconnect limpa o perfil', async () => {
    const auth = freshAuth();
    mockOpenAuth.mockImplementationOnce(async (url: string) => {
      const state = new URL(url).searchParams.get('state');
      return { type: 'success', url: `dyarium://oauth?state=${state}&code=code-1` };
    });
    installFetch(async (url: string) => {
      if (url === TOKEN_ENDPOINT) {
        return tokenResponse({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 3600,
        });
      }
      return tokenResponse({ name: 'Ana', email: 'a@b.com', picture: 'pic' });
    });
    await auth.connectDrive();

    installFetch(async () => tokenResponse({}, 200));
    await auth.disconnectDrive();
    expect(auth.driveProfile()).toBeNull();
  });
});
