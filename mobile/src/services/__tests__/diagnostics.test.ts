/**
 * Diagnostico: sem DSN nada sai; com DSN, o evento vai sem identidade e a
 * opcao do usuario desliga o cliente.
 */

const mockInit = jest.fn();
const mockClose = jest.fn(async () => true);
const mockFlags = new Map<string, string>();

jest.mock('@sentry/react-native', () => ({
  init: (options: unknown) => mockInit(options),
  close: () => mockClose(),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: {} } },
}));

jest.mock('../db', () => ({
  getAppFlag: jest.fn(async (key: string) => mockFlags.get(key) ?? null),
  setAppFlag: jest.fn(async (key: string, value: string) => {
    mockFlags.set(key, value);
  }),
}));

type Diagnostics = typeof import('../diagnostics');

function load(): Diagnostics {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../diagnostics') as Diagnostics;
}

beforeEach(() => {
  jest.resetModules();
  mockInit.mockClear();
  mockClose.mockClear();
  mockFlags.clear();
  delete process.env.EXPO_PUBLIC_SENTRY_DSN;
});

describe('diagnostico anonimo', () => {
  it('sem DSN nao inicia nada', async () => {
    const diagnostics = load();
    await diagnostics.initDiagnostics();
    expect(diagnostics.diagnosticsConfigured()).toBe(false);
    expect(mockInit).not.toHaveBeenCalled();
  });

  it('inicia sem PII, sem breadcrumbs e sem request', async () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://public@sentry.example/1';
    const diagnostics = load();
    await diagnostics.initDiagnostics();

    expect(mockInit).toHaveBeenCalledTimes(1);
    const options = mockInit.mock.calls[0][0] as {
      dsn: string;
      sendDefaultPii: boolean;
      maxBreadcrumbs: number;
      tracesSampleRate: number;
      beforeBreadcrumb: () => null;
      beforeSend: (event: Record<string, unknown>) => Record<string, unknown> | null;
    };
    expect(options.dsn).toBe('https://public@sentry.example/1');
    expect(options.sendDefaultPii).toBe(false);
    expect(options.maxBreadcrumbs).toBe(0);
    expect(options.tracesSampleRate).toBe(0);
    expect(options.beforeBreadcrumb()).toBeNull();

    const event = options.beforeSend({
      user: { id: 'user-1' },
      request: { url: 'https://exemplo/segredo' },
      message: 'falhou',
    });
    expect(event).toEqual({ message: 'falhou' });
  });

  it('respeita a opcao salva desligada', async () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://public@sentry.example/1';
    mockFlags.set('diagnostics.enabled', '0');
    const diagnostics = load();
    await diagnostics.initDiagnostics();
    expect(await diagnostics.readDiagnosticsEnabled()).toBe(false);
    expect(mockInit).not.toHaveBeenCalled();
  });

  it('desligar fecha o cliente e grava a opcao; ligar inicia de novo', async () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://public@sentry.example/1';
    const diagnostics = load();
    await diagnostics.initDiagnostics();
    expect(mockInit).toHaveBeenCalledTimes(1);

    await diagnostics.setDiagnosticsEnabled(false);
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(mockFlags.get('diagnostics.enabled')).toBe('0');

    await diagnostics.setDiagnosticsEnabled(true);
    expect(mockFlags.get('diagnostics.enabled')).toBe('1');
    expect(mockInit).toHaveBeenCalledTimes(2);
  });

  it('o toggle desligado tambem bloqueia um beforeSend atrasado', async () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://public@sentry.example/1';
    const diagnostics = load();
    await diagnostics.initDiagnostics();
    const options = mockInit.mock.calls[0][0] as {
      beforeSend: (event: Record<string, unknown>) => Record<string, unknown> | null;
    };
    await diagnostics.setDiagnosticsEnabled(false);
    expect(options.beforeSend({ message: 'erro' })).toBeNull();
  });
});
