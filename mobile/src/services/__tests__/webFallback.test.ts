/**
 * O app tambem abre no navegador. La nao existem `expo-file-system` nem
 * `expo-secure-store`: sem a guarda de plataforma, a tela da nota estourava em
 * `new Directory(Paths.document)` e as preferencias nao gravavam.
 */

import { Platform } from 'react-native';

import { analysisModelFilePath, installedAnalysisModels } from '../analysisModels';
import { loadPrefs, loadServerConfig, savePrefs, saveServerConfig, clearServerConfig } from '../secure';
import { installedModels, modelFilePath } from '../transcriptionModels';

const originalOS = Platform.OS;

function setPlatform(os: typeof Platform.OS): void {
  (Platform as { OS: typeof Platform.OS }).OS = os;
}

/** `localStorage` minimo: o jest roda em node, sem DOM. */
function installWebStorage(): Map<string, string> {
  const values = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
  return values;
}

afterEach(() => {
  setPlatform(originalOS);
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('modelos locais no navegador', () => {
  beforeEach(() => {
    setPlatform('web');
  });

  it('nao lista nem resolve caminho de modelo de transcricao', () => {
    expect(installedModels()).toEqual([]);
    expect(modelFilePath('tiny')).toBeNull();
  });

  it('nao lista nem resolve caminho de modelo de analise', () => {
    expect(installedAnalysisModels()).toEqual([]);
    expect(analysisModelFilePath('lfm2.5-230m-q4')).toBeNull();
  });
});

describe('configuracao e preferencias no navegador', () => {
  beforeEach(() => {
    setPlatform('web');
    installWebStorage();
  });

  it('guarda e apaga a configuracao do servidor', async () => {
    await saveServerConfig({ baseUrl: 'https://exemplo.local', token: 'segredo' });
    expect(await loadServerConfig()).toEqual({
      baseUrl: 'https://exemplo.local',
      token: 'segredo',
    });

    await clearServerConfig();
    expect(await loadServerConfig()).toBeNull();
  });

  it('guarda as preferencias', async () => {
    await savePrefs({ swipeAction: 'archive' });
    expect((await loadPrefs()).swipeAction).toBe('archive');
  });
});
