import { discoverServer } from '../discovery';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { hostUri: '192.0.2.10:8081' } },
}));

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});

function healthz(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

describe('discoverServer', () => {
  it('aceita o servidor que responde /healthz com status e versao', async () => {
    fetchMock.mockResolvedValue(healthz({ status: 'ok', version: '0.5.1' }));

    await expect(discoverServer()).resolves.toBe('http://192.0.2.10:8080');
  });

  it('recusa health check generico, sem a versao do dyarium', async () => {
    fetchMock.mockResolvedValue(healthz({ status: 'ok' }));

    // Nenhum candidato passa: o primeiro da lista nao basta parecer saudavel.
    await expect(discoverServer()).resolves.toBeNull();
  });

  it('recusa status diferente de ok', async () => {
    fetchMock.mockResolvedValue(healthz({ status: 'degraded', version: '0.5.1' }));

    await expect(discoverServer()).resolves.toBeNull();
  });

  it('recusa resposta HTTP de erro', async () => {
    fetchMock.mockResolvedValue(healthz({ status: 'ok', version: '0.5.1' }, false));

    await expect(discoverServer()).resolves.toBeNull();
  });

  it('devolve null quando a rede falha', async () => {
    fetchMock.mockRejectedValue(new Error('unreachable'));

    await expect(discoverServer()).resolves.toBeNull();
  });
});
