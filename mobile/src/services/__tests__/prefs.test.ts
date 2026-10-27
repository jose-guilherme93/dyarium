import { loadPrefs, savePrefs, type Prefs } from '@/services/secure';

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

  it('guarda que o aviso de transcricao foi dispensado', async () => {
    const prefs: Prefs = { swipeAction: 'delete', transcriptionPromptDismissed: true };

    await savePrefs(prefs);

    await expect(loadPrefs()).resolves.toMatchObject({
      transcriptionPromptDismissed: true,
    });
  });

  it('nao dispensa o aviso por padrao', async () => {
    await expect(loadPrefs()).resolves.toMatchObject({
      transcriptionPromptDismissed: false,
    });
  });
});
