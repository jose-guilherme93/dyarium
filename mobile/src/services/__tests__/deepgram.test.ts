import { parseDeepgramResponse, transcribeDeepgramWindow } from '../deepgram';

const response = {
  results: {
    channels: [
      {
        detected_language: 'pt',
        alternatives: [
          {
            transcript: 'bom dia tudo bem',
            words: [
              { word: 'bom', punctuated_word: 'Bom', start: 0.1, end: 0.4 },
              { word: 'dia', punctuated_word: 'dia', start: 0.4, end: 0.8 },
              { word: 'tudo', punctuated_word: 'tudo', start: 1.2, end: 1.6 },
              { word: 'bem', punctuated_word: 'bem', start: 1.6, end: 2 },
            ],
            paragraphs: {
              paragraphs: [
                {
                  sentences: [
                    { text: 'Bom dia.', start: 0.1, end: 0.8 },
                    { text: 'Tudo bem.', start: 1.2, end: 2 },
                  ],
                },
              ],
            },
          },
        ],
      },
    ],
  },
};

describe('parseDeepgramResponse', () => {
  it('usa as frases com inicio e fim para os segmentos', () => {
    expect(parseDeepgramResponse(response, 60_000)).toEqual({
      language: 'pt',
      text: 'Bom dia. Tudo bem.',
      segments: [
        { start_ms: 60_100, end_ms: 60_800, text: 'Bom dia.' },
        { start_ms: 61_200, end_ms: 62_000, text: 'Tudo bem.' },
      ],
    });
  });

  it('sem frases, agrupa as palavras em segmentos curtos', () => {
    const wordsOnly = {
      results: {
        channels: [
          {
            alternatives: [
              {
                transcript: 'a b c',
                words: [
                  { word: 'a', start: 0, end: 0.5 },
                  { word: 'b', start: 0.5, end: 1 },
                  { word: 'c', start: 5, end: 5.5 },
                ],
              },
            ],
          },
        ],
      },
    };
    const parsed = parseDeepgramResponse(wordsOnly, 1000);
    expect(parsed.segments[0]).toMatchObject({ start_ms: 1000, end_ms: 2000, text: 'a b' });
    expect(parsed.segments[1]).toMatchObject({ start_ms: 6000, end_ms: 6500, text: 'c' });
  });

  it('resposta sem alternativa vira vazio, sem estourar', () => {
    expect(parseDeepgramResponse({}, 0)).toEqual({ language: '', text: '', segments: [] });
    expect(parseDeepgramResponse(null, 0)).toEqual({ language: '', text: '', segments: [] });
  });

  it('nao inventa segmento com texto vazio', () => {
    const empty = {
      results: { channels: [{ alternatives: [{ transcript: '   ', words: [] }] }] },
    };
    expect(parseDeepgramResponse(empty, 0).segments).toEqual([]);
  });
});

describe('transcribeDeepgramWindow', () => {
  it('manda a janela como WAV e devolve o texto deslocado', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => response,
    }));
    const result = await transcribeDeepgramWindow({
      audio: new Uint8Array([1, 2, 3]),
      apiKey: 'dg-key',
      model: 'nova-3',
      language: 'pt',
      offsetMs: 0,
      fetchImpl: fetchMock as never,
    });

    expect(result.text).toBe('Bom dia. Tudo bem.');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('https://api.deepgram.com/v1/listen');
    expect(url).toContain('model=nova-3');
    expect(url).toContain('language=pt');
    expect((init.headers as Record<string, string>).Authorization).toBe('Token dg-key');
    expect(init.method).toBe('POST');
  });

  it('erro de chave vira erro claro e sem vazar a chave', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => 'invalid credentials',
    }));

    await expect(
      transcribeDeepgramWindow({
        audio: new Uint8Array([1]),
        apiKey: 'segredo-do-usuario',
        model: 'nova-3',
        language: 'pt',
        offsetMs: 0,
        fetchImpl: fetchMock as never,
      }),
    ).rejects.toMatchObject({ code: 'invalid_key' });
  });

  it('limite de taxa e falha do provedor pedem nova tentativa', async () => {
    for (const status of [429, 503]) {
      const fetchMock = jest.fn(async () => ({ ok: false, status, text: async () => '' }));
      await expect(
        transcribeDeepgramWindow({
          audio: new Uint8Array([1]),
          apiKey: 'k',
          model: 'nova-3',
          language: 'pt',
          offsetMs: 0,
          fetchImpl: fetchMock as never,
        }),
      ).rejects.toMatchObject({ retryable: true });
    }
  });
});
