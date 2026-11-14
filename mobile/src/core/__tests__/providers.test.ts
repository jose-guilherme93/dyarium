import {
  ANALYSIS_PROVIDERS,
  DEEPGRAM_MODELS,
  DEFAULT_DEEPGRAM_MODEL,
  analysisProviderById,
  normalizeAnalysisProvider,
  resolveAnalysisBaseUrl,
} from '../providers';

describe('provedores online', () => {
  it('traz os provedores que a web oferece, com endpoint compativel', () => {
    const ids = ANALYSIS_PROVIDERS.map((provider) => provider.id);
    expect(ids).toEqual(
      expect.arrayContaining(['openrouter', 'groq', 'google', 'deepseek', 'mistral', 'xai', 'custom']),
    );
    for (const provider of ANALYSIS_PROVIDERS) {
      if (provider.id === 'custom') continue;
      expect(provider.baseUrl.startsWith('https://')).toBe(true);
      expect(provider.model).not.toBe('');
    }
  });

  it('id desconhecido cai no personalizado em vez de estourar', () => {
    expect(normalizeAnalysisProvider('nao-existe')).toBe('custom');
    expect(analysisProviderById('nao-existe')?.id).toBe('custom');
    expect(analysisProviderById(undefined)?.id).toBe('custom');
  });

  it('o personalizado usa a URL do aparelho e ignora a do preset', () => {
    expect(resolveAnalysisBaseUrl('custom', 'http://127.0.0.1:11434/v1')).toBe(
      'http://127.0.0.1:11434/v1',
    );
    expect(resolveAnalysisBaseUrl('custom', '')).toBe('');
    expect(resolveAnalysisBaseUrl('groq', '')).toBe('https://api.groq.com/openai/v1');
    expect(resolveAnalysisBaseUrl('groq', 'https://exemplo/v1')).toBe('https://api.groq.com/openai/v1');
  });

  it('Deepgram segue o catalogo da web e nasce em nova-3', () => {
    expect(DEFAULT_DEEPGRAM_MODEL).toBe('nova-3');
    expect(DEEPGRAM_MODELS).toContain('nova-3');
    expect(DEEPGRAM_MODELS).toContain('nova-2');
  });
});
