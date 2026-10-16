import { ApiError, DyariumApi, type FetchLike, type HttpResponse } from '../api';

function resp(status: number, body: unknown): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

interface Call {
  url: string;
  init?: { method?: string; headers?: Record<string, string>; body?: unknown };
}

function makeApi(handler: (call: Call) => HttpResponse) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call: Call = { url, init };
    calls.push(call);
    return handler(call);
  };
  const api = new DyariumApi({ baseUrl: 'http://host:8080/', token: 'tok' }, fetchImpl);
  return { api, calls };
}

describe('DyariumApi', () => {
  it('normaliza a baseUrl e envia o token Bearer', async () => {
    const { api, calls } = makeApi(() => resp(200, { version: '1.0', commit: 'x', built_at: 'y' }));
    await api.version();
    expect(calls[0].url).toBe('http://host:8080/api/v1/version');
    expect(calls[0].init?.headers?.Authorization).toBe('Bearer tok');
  });

  it('healthz nao envia autenticacao', async () => {
    const { api, calls } = makeApi(() => resp(200, { status: 'ok', version: '1.0' }));
    const out = await api.healthz();
    expect(out.status).toBe('ok');
    expect(calls[0].init?.headers).toBeUndefined();
  });

  it('createUpload envia JSON com client_key', async () => {
    const { api, calls } = makeApi(() => resp(201, { id: 'up1', offset: 0, expires_at: 'z' }));
    await api.createUpload({
      client_key: 'ck_1',
      filename: 'nota.aac',
      content_type: 'audio/aac',
      size_bytes: 10,
    });
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.headers?.['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(calls[0].init?.body)).client_key).toBe('ck_1');
  });

  it('putChunk envia X-Upload-Offset e o corpo binario', async () => {
    const { api, calls } = makeApi(() => resp(200, { id: 'up1', offset: 4, received_bytes: 4 }));
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    const out = await api.putChunk('up1', 0, bytes);
    expect(calls[0].init?.headers?.['X-Upload-Offset']).toBe('0');
    expect(calls[0].init?.body).toBe(bytes);
    expect(out.offset).toBe(4);
  });

  it('mapeia erro do servidor para ApiError com codigo', async () => {
    const { api } = makeApi(() =>
      resp(401, { error: { code: 'unauthorized', message: 'token invalido' } }),
    );
    await expect(api.version()).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
      message: 'token invalido',
    });
  });

  it('extrai o offset de um 409', async () => {
    const { api } = makeApi(() =>
      resp(409, { error: { code: 'offset_mismatch', message: 'x' }, offset: 8 }),
    );
    const err = await api.putChunk('up1', 0, Uint8Array.from([1])).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).offset).toBe(8);
  });

  it('getEntry busca o resumo autenticado da entrada', async () => {
    const { api, calls } = makeApi(() => resp(200, { id: 'en1', status: 'failed', title: 'x' }));
    const out = await api.getEntry('en1');
    expect(calls[0].url).toBe('http://host:8080/api/v1/entries/en1');
    expect(calls[0].init?.headers?.Authorization).toBe('Bearer tok');
    expect(out.status).toBe('failed');
  });

  it('listEntries pede a lista com limite e identidade', async () => {
    const { api, calls } = makeApi(() =>
      resp(200, { entries: [{ id: 'en1', status: 'ready', origin_key: 'sha256:abc' }] }),
    );
    const out = await api.listEntries(500);
    expect(calls[0].url).toBe('http://host:8080/api/v1/entries?limit=500');
    expect(out.entries[0].origin_key).toBe('sha256:abc');
  });

  it('deleteEntry usa DELETE autenticado', async () => {
    const { api, calls } = makeApi(() => ({ ok: true, status: 204, text: async () => '' }));
    await api.deleteEntry('en1');
    expect(calls[0].url).toBe('http://host:8080/api/v1/entries/en1');
    expect(calls[0].init?.method).toBe('DELETE');
  });
});
