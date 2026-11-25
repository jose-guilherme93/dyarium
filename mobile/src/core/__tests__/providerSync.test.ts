import type { ServerSettings } from '../api';
import {
  importFromServerSettings,
  languageFromServer,
  presetFromServer,
  settingsPatchFromLocal,
} from '../providerSync';

const settings: ServerSettings = {
  owner_name: '',
  all_notes_mine: true,
  trim_silence: false,
  whisper_model: 'small',
  whisper_language: 'pt',
  transcribe_provider: 'deepgram',
  deepgram_model: 'nova-2',
  deepgram_api_key_set: true,
  analyze_enabled: true,
  analyze_provider: 'openai',
  analyze_local_runtime: '',
  analyze_base_url: 'https://api.groq.com/openai/v1',
  analyze_model: 'llama-3.3-70b-versatile',
  analyze_api_key_set: true,
  analysis_themes: '',
  review_enabled: true,
  literal_transcript: true,
};

describe('importar do servidor', () => {
  it('traz provedor, modelo, idioma e revisao sem copiar chave', () => {
    const imported = importFromServerSettings(settings);
    expect(imported).toEqual({
      transcriptionOnlineModel: 'nova-2',
      analysisProvider: 'groq',
      analysisBaseUrl: 'https://api.groq.com/openai/v1',
      analysisOnlineModel: 'llama-3.3-70b-versatile',
      transcriptionLanguage: 'pt',
      reviewTranscript: true,
      literalTranscript: true,
    });
    expect(JSON.stringify(imported)).not.toContain('api_key');
  });

  it('URL fora dos presets vira personalizado', () => {
    expect(
      presetFromServer('openai', 'https://meu-provedor.local/v1', ''),
    ).toBe('custom');
    expect(presetFromServer('openai', '', 'ollama')).toBe('custom');
  });

  it('idioma do servidor so vira pt quando era pt', () => {
    expect(languageFromServer('pt')).toBe('pt');
    expect(languageFromServer('')).toBe('auto');
    expect(languageFromServer('en')).toBe('auto');
  });
});

describe('enviar para o servidor', () => {
  const local = {
    place: 'online' as const,
    transcriptionOnlineModel: 'nova-3',
    analysisProvider: 'groq',
    analysisBaseUrl: '',
    analysisOnlineModel: 'llama-3.3-70b-versatile',
    transcriptionLanguage: 'auto' as const,
    reviewTranscript: false,
    literalTranscript: false,
  };

  it('manda provedor e modelo do preset', () => {
    const patch = settingsPatchFromLocal(local);
    expect(patch).toMatchObject({
      transcribe_provider: 'deepgram',
      deepgram_model: 'nova-3',
      analyze_provider: 'openai',
      analyze_base_url: 'https://api.groq.com/openai/v1',
      analyze_model: 'llama-3.3-70b-versatile',
      whisper_language: '',
    });
    expect(patch.deepgram_api_key).toBeUndefined();
    expect(patch.analyze_api_key).toBeUndefined();
  });

  it('chave so vai quando existe no aparelho', () => {
    const patch = settingsPatchFromLocal({
      ...local,
      analysisProvider: 'custom',
      analysisBaseUrl: 'http://127.0.0.1:11434/v1',
      deepgramKey: 'dg',
      analysisKey: 'sk',
    });
    expect(patch).toMatchObject({
      analyze_base_url: 'http://127.0.0.1:11434/v1',
      deepgram_api_key: 'dg',
      analyze_api_key: 'sk',
    });
  });

  it('analise vazia no aparelho nao apaga a do servidor', () => {
    const patch = settingsPatchFromLocal({
      ...local,
      analysisProvider: 'custom',
      analysisBaseUrl: '',
      analysisOnlineModel: '',
    });
    expect(patch.analyze_base_url).toBeUndefined();
    expect(patch.analyze_model).toBeUndefined();
    expect(patch.analyze_provider).toBeUndefined();
  });
});
