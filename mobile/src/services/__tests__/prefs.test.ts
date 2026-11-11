import { loadPrefs, savePrefs } from '@/services/secure';

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

describe('preferencias locais', () => {
  beforeEach(() => {
    mockFlags.clear();
    mockStore.clear();
  });

  it('instalacao nova nasce com as tres etapas desligadas', async () => {
    await expect(loadPrefs()).resolves.toMatchObject({
      transcriptionEnabled: false,
      analysisEnabled: false,
      serverProcessing: false,
    });
  });

  it('migra a escolha antiga de aparelho sem mandar trabalho ao servidor', async () => {
    mockFlags.set(
      'dyarium.prefs',
      JSON.stringify({ swipeAction: 'delete', localTranscription: true }),
    );

    await expect(loadPrefs()).resolves.toMatchObject({
      transcriptionEnabled: true,
      analysisEnabled: true,
      serverProcessing: false,
    });
  });

  it('migra a escolha antiga de servidor', async () => {
    mockFlags.set(
      'dyarium.prefs',
      JSON.stringify({ swipeAction: 'delete', localTranscription: false }),
    );

    await expect(loadPrefs()).resolves.toMatchObject({
      transcriptionEnabled: true,
      serverProcessing: true,
    });
  });

  it('grava e devolve o tema pelo SQLite, nao pelo cofre', async () => {
    const loaded = await loadPrefs();
    await savePrefs({ ...loaded, theme: 'dark' });

    expect(mockFlags.get('dyarium.prefs')).toContain('"theme":"dark"');
    expect(mockStore.size).toBe(0);
    await expect(loadPrefs()).resolves.toMatchObject({ theme: 'dark' });
  });

  it('blob corrompido nao derruba a tela: volta aos padroes', async () => {
    mockFlags.set('dyarium.prefs', '{isso nao e json');

    await expect(loadPrefs()).resolves.toMatchObject({
      transcriptionEnabled: false,
      analysisEnabled: false,
      serverProcessing: false,
    });
  });

  it('tema desconhecido no armazenamento cai no padrao, sem quebrar', async () => {
    mockFlags.set(
      'dyarium.prefs',
      JSON.stringify({ version: 2, theme: 'neon-verde', swipeAction: 'delete' }),
    );

    await expect(loadPrefs()).resolves.toMatchObject({ theme: 'amoled' });
  });

  it('copia o blob antigo do cofre para o SQLite e apaga o segredo', async () => {
    mockStore.set(
      'dyarium.prefs',
      JSON.stringify({ version: 2, theme: 'light', swipeAction: 'archive' }),
    );

    await expect(loadPrefs()).resolves.toMatchObject({
      theme: 'light',
      swipeAction: 'archive',
    });
    expect(mockFlags.get('dyarium.prefs')).toContain('"theme":"light"');
    expect(mockStore.has('dyarium.prefs')).toBe(false);
  });
});
