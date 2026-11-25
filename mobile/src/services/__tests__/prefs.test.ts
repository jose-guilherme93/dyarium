import { loadPrefs, loadProviderKey, savePrefs, saveProviderKey, clearProviderKey } from '@/services/secure';

const mockFlags = new Map<string, string>();
const mockStore = new Map<string, string>();

jest.mock('@/services/db', () => ({
  getAppFlag: jest.fn(async (key: string) => mockFlags.get(key) ?? null),
  setAppFlag: jest.fn(async (key: string, value: string) => {
    mockFlags.set(key, value);
  }),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));

function writeServers(server: { baseUrl: string; token: string } | null) {
  if (!server) {
    mockStore.delete('dyarium.servers');
    return;
  }
  mockStore.set(
    'dyarium.servers',
    JSON.stringify([{ id: 'i1', baseUrl: server.baseUrl, token: server.token, contract: '1' }]),
  );
}

describe('preferencias locais', () => {
  beforeEach(() => {
    mockFlags.clear();
    mockStore.clear();
  });

  it('instalacao nova nasce com as etapas desligadas', async () => {
    await expect(loadPrefs()).resolves.toMatchObject({
      transcriptionPlace: 'off',
      analysisPlace: 'off',
    });
  });

  it('migra o blob anterior aos tres interruptores com escolha de aparelho', async () => {
    mockFlags.set(
      'dyarium.prefs',
      JSON.stringify({ swipeAction: 'delete', localTranscription: true }),
    );

    await expect(loadPrefs()).resolves.toMatchObject({
      transcriptionPlace: 'device',
      analysisPlace: 'device',
    });
  });

  it('migra o blob anterior com escolha de servidor', async () => {
    writeServers({ baseUrl: 'http://s', token: 't' });
    mockFlags.set(
      'dyarium.prefs',
      JSON.stringify({ swipeAction: 'delete', localTranscription: false }),
    );

    await expect(loadPrefs()).resolves.toMatchObject({
      transcriptionPlace: 'server',
      analysisPlace: 'server',
    });
  });

  it('migra a versao 2 com servidor escolhido para o mesmo lugar', async () => {
    writeServers({ baseUrl: 'http://s', token: 't' });
    mockFlags.set(
      'dyarium.prefs',
      JSON.stringify({
        version: 2,
        swipeAction: 'delete',
        transcriptionEnabled: true,
        analysisEnabled: true,
        serverProcessing: true,
      }),
    );

    await expect(loadPrefs()).resolves.toMatchObject({
      transcriptionPlace: 'server',
      analysisPlace: 'server',
    });
  });

  it('migra a versao 2 sem servidor para o aparelho quando havia modelo escolhido', async () => {
    mockFlags.set(
      'dyarium.prefs',
      JSON.stringify({
        version: 2,
        swipeAction: 'delete',
        transcriptionEnabled: true,
        transcriptionModel: 'small',
        analysisEnabled: false,
      }),
    );

    await expect(loadPrefs()).resolves.toMatchObject({
      transcriptionPlace: 'device',
      analysisPlace: 'off',
    });
  });

  it('grava e devolve o tema pelo SQLite, nao pelo cofre', async () => {
    const loaded = await loadPrefs();
    await savePrefs({ ...loaded, theme: 'dark' });

    expect(mockFlags.get('dyarium.prefs')).toContain('"theme":"dark"');
    expect(mockStore.has('dyarium.prefs')).toBe(false);
    await expect(loadPrefs()).resolves.toMatchObject({ theme: 'dark' });
  });

  it('blob corrompido nao derruba a tela: volta aos padroes', async () => {
    mockFlags.set('dyarium.prefs', '{isso nao e json');

    await expect(loadPrefs()).resolves.toMatchObject({
      transcriptionPlace: 'off',
      analysisPlace: 'off',
    });
  });

  it('tema desconhecido no armazenamento cai no padrao, sem quebrar', async () => {
    mockFlags.set(
      'dyarium.prefs',
      JSON.stringify({ version: 3, theme: 'neon-verde', swipeAction: 'delete' }),
    );

    await expect(loadPrefs()).resolves.toMatchObject({ theme: 'amoled' });
  });

  it('copia o blob antigo do cofre para o SQLite e apaga o segredo', async () => {
    mockStore.set(
      'dyarium.prefs',
      JSON.stringify({ version: 3, theme: 'light', swipeAction: 'archive' }),
    );

    await expect(loadPrefs()).resolves.toMatchObject({
      theme: 'light',
      swipeAction: 'archive',
    });
    expect(mockFlags.get('dyarium.prefs')).toContain('"theme":"light"');
    expect(mockStore.has('dyarium.prefs')).toBe(false);
  });
});

describe('chaves de provedor online', () => {
  beforeEach(() => {
    mockFlags.clear();
    mockStore.clear();
  });

  it('guarda a chave no cofre e devolve por etapa', async () => {
    await saveProviderKey('transcription', 'dg-123');
    await saveProviderKey('analysis', 'sk-456');

    await expect(loadProviderKey('transcription')).resolves.toBe('dg-123');
    await expect(loadProviderKey('analysis')).resolves.toBe('sk-456');
    expect(mockStore.get('dyarium.provider.transcription.key')).toBe('dg-123');
    expect(mockStore.get('dyarium.provider.analysis.key')).toBe('sk-456');
  });

  it('a chave nunca entra no blob de preferencias', async () => {
    await saveProviderKey('analysis', 'sk-456');
    const loaded = await loadPrefs();
    await savePrefs(loaded);

    expect(mockFlags.get('dyarium.prefs')).not.toContain('sk-456');
  });

  it('apagar a chave a remove do cofre', async () => {
    await saveProviderKey('transcription', 'dg-123');
    await clearProviderKey('transcription');

    await expect(loadProviderKey('transcription')).resolves.toBeNull();
  });

  it('chave vazia e tratada como ausente', async () => {
    await saveProviderKey('analysis', '   ');

    await expect(loadProviderKey('analysis')).resolves.toBeNull();
  });
});
