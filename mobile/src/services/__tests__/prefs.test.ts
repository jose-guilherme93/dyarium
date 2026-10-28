import { loadPrefs } from '@/services/secure';

const mockStore = new Map<string, string>();

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
    mockStore.set(
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
    mockStore.set(
      'dyarium.prefs',
      JSON.stringify({ swipeAction: 'delete', localTranscription: false }),
    );

    await expect(loadPrefs()).resolves.toMatchObject({
      transcriptionEnabled: true,
      serverProcessing: true,
    });
  });
});
