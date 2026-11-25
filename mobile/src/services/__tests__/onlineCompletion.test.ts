import { completeOnline, OnlineCompletionError } from '../onlineCompletion';

const mockPrefs = {
  analysisProvider: 'groq',
  analysisBaseUrl: '',
  analysisOnlineModel: 'llama-3.3-70b-versatile',
};
const mockKey: { value: string | null } = { value: 'sk-1' };

jest.mock('../secure', () => ({
  loadPrefs: async () => mockPrefs,
  loadProviderKey: async () => mockKey.value,
}));

const messages = [
  { role: 'system', content: 'devolva JSON' },
  { role: 'user', content: 'texto' },
];

describe('completeOnline', () => {
  beforeEach(() => {
    mockKey.value = 'sk-1';
  });

  it('fala com o provedor do preset e devolve texto e tokens', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 11, completion_tokens: 7 },
      }),
    }));

    const result = await completeOnline(messages, { fetchImpl: fetchMock as never });
    expect(result.text).toBe('{"ok":true}');
    expect(result.promptTokens).toBe(11);
    expect(result.completionTokens).toBe(7);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-1');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.model).toBe('llama-3.3-70b-versatile');
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('repete sem response_format quando o provedor recusa o campo', async () => {
    const calls: RequestInit[] = [];
    const fetchMock = jest.fn(async (_url: string, init: RequestInit) => {
      calls.push(init);
      if (calls.length === 1) return { ok: false, status: 400, text: async () => '' };
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }),
      };
    });

    await completeOnline(messages, { fetchImpl: fetchMock as never });
    expect(calls).toHaveLength(2);
    expect(JSON.parse(String(calls[0]?.body)).response_format).toEqual({ type: 'json_object' });
    expect(JSON.parse(String(calls[1]?.body)).response_format).toBeUndefined();
  });

  it('sem chave nem chama a rede', async () => {
    mockKey.value = null;
    const fetchMock = jest.fn();
    await expect(
      completeOnline(messages, { fetchImpl: fetchMock as never }),
    ).rejects.toMatchObject({ code: 'no_key' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('erro de autenticacao nao vaza a chave', async () => {
    const fetchMock = jest.fn(async () => ({ ok: false, status: 401, text: async () => '' }));
    const error = await completeOnline(messages, { fetchImpl: fetchMock as never }).catch(
      (value: unknown) => value,
    );
    expect(error).toBeInstanceOf(OnlineCompletionError);
    expect((error as OnlineCompletionError).code).toBe('auth');
    expect(String(error)).not.toContain('sk-1');
  });

  it('limite de taxa e falha do provedor sao retentaveis', async () => {
    for (const status of [429, 502]) {
      const fetchMock = jest.fn(async () => ({ ok: false, status, text: async () => '' }));
      await expect(
        completeOnline(messages, { fetchImpl: fetchMock as never }),
      ).rejects.toMatchObject({ retryable: true });
    }
  });
});
