/**
 * Cliente REST do Google Drive: paginacao, retentativas, renovacao do token e
 * limites de tamanho. O corpo de erro do Drive nunca chega a mensagem.
 */

import { DriveClient, DriveError } from '../driveClient';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

type FetchCall = [string, RequestInit | undefined];

function response(
  payload: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(Object.entries(init.headers ?? {})),
    json: async () => payload,
    text: async () => '',
  } as unknown as Response;
}

function makeClient(fetcher: jest.Mock, token: jest.Mock = jest.fn(async () => 'token-1')): DriveClient {
  return new DriveClient(token, {
    fetchImpl: fetcher as unknown as typeof fetch,
    sleep: jest.fn(async () => undefined),
  });
}

function called(call: readonly unknown[]): { url: URL; init: RequestInit } {
  const [url, init] = call as unknown as FetchCall;
  return { url: new URL(url), init: init ?? {} };
}

describe('findChild', () => {
  it('escapa barra invertida e apostrofo no nome', async () => {
    const fetcher = jest.fn(async () => response({ files: [] }));
    const client = makeClient(fetcher);

    await expect(client.findChild('folder-1', "a'b\\c")).resolves.toBeUndefined();

    const { url, init } = called(fetcher.mock.calls[0]);
    expect(url.toString().startsWith(`${API}/files?`)).toBe(true);
    expect(url.searchParams.get('q')).toBe(
      "name = 'a\\'b\\\\c' and trashed = false and 'folder-1' in parents",
    );
    expect(url.searchParams.get('fields')).toBe('files(id,name,mimeType,modifiedTime,size)');
    expect(url.searchParams.get('spaces')).toBe('drive');
    expect(url.searchParams.get('pageSize')).toBe('10');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-1');
  });

  it('devolve o primeiro arquivo encontrado', async () => {
    const fetcher = jest.fn(async () =>
      response({
        files: [
          { id: 'f1', name: 'backup.enc', mimeType: 'application/octet-stream', size: '10' },
        ],
      }),
    );
    const client = makeClient(fetcher);

    await expect(client.findChild('folder-1', 'backup.enc')).resolves.toEqual({
      id: 'f1',
      name: 'backup.enc',
      mimeType: 'application/octet-stream',
      size: '10',
    });
  });
});

describe('list', () => {
  it('segue nextPageToken ate o fim', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(response({ files: [{ id: '1', name: 'a' }], nextPageToken: 'p2' }))
      .mockResolvedValueOnce(response({ files: [{ id: '2', name: 'b' }] }));
    const client = makeClient(fetcher);

    await expect(client.list('folder-1')).resolves.toEqual([
      { id: '1', name: 'a' },
      { id: '2', name: 'b' },
    ]);

    expect(fetcher).toHaveBeenCalledTimes(2);
    const first = called(fetcher.mock.calls[0]);
    expect(first.url.searchParams.get('q')).toBe("'folder-1' in parents and trashed = false");
    expect(first.url.searchParams.get('pageSize')).toBe('1000');
    const second = called(fetcher.mock.calls[1]);
    expect(second.url.searchParams.get('pageToken')).toBe('p2');
  });

  it('para no teto de 100 paginas', async () => {
    const fetcher = jest.fn(async () =>
      response({ files: [{ id: 'x', name: 'x' }], nextPageToken: 'mais' }),
    );
    const client = makeClient(fetcher);

    const files = await client.list('folder-1');

    expect(fetcher).toHaveBeenCalledTimes(100);
    expect(files).toHaveLength(100);
  });
});

describe('ensureFolder', () => {
  it('usa a pasta existente', async () => {
    const fetcher = jest.fn(async () =>
      response({ files: [{ id: 'pasta-1', name: 'Dyarium', mimeType: FOLDER_MIME }] }),
    );
    const client = makeClient(fetcher);

    await expect(client.ensureFolder('Dyarium', 'root-1')).resolves.toBe('pasta-1');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('cria quando falta', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(response({ files: [] }))
      .mockResolvedValueOnce(response({ id: 'nova' }));
    const client = makeClient(fetcher);

    await expect(client.ensureFolder('Dyarium', 'root-1')).resolves.toBe('nova');

    expect(fetcher).toHaveBeenCalledTimes(2);
    const { url, init } = called(fetcher.mock.calls[1]);
    expect(url.pathname.endsWith('/files')).toBe(true);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'Dyarium',
      mimeType: FOLDER_MIME,
      parents: ['root-1'],
    });
  });
});

describe('token e retentativas', () => {
  it('renova uma vez no 401 e refaz a chamada', async () => {
    const token = jest.fn(async (force?: boolean) => (force ? 'token-2' : 'token-1'));
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(response({}, { status: 401 }))
      .mockResolvedValueOnce(response({ files: [] }));
    const client = makeClient(fetcher, token);

    await expect(client.findChild('folder-1', 'nota')).resolves.toBeUndefined();

    expect(token).toHaveBeenLastCalledWith(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const second = called(fetcher.mock.calls[1]);
    expect((second.init.headers as Record<string, string>).Authorization).toBe('Bearer token-2');
  });

  it('nao renova duas vezes no mesmo pedido', async () => {
    const token = jest.fn(async (force?: boolean) => (force ? 'token-2' : 'token-1'));
    const fetcher = jest.fn(async () => response({}, { status: 401 }));
    const client = makeClient(fetcher, token);

    const error = await client.findChild('folder-1', 'nota').catch((caught) => caught);

    expect(error).toBeInstanceOf(DriveError);
    expect((error as DriveError).kind).toBe('auth');
    expect((error as DriveError).status).toBe(401);
    expect(token.mock.calls.filter((call) => call[0] === true)).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('429 e 5xx esperam 1s e 3s antes de tentar de novo', async () => {
    const sleep = jest.fn(async (_ms: number) => undefined);
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(response({}, { status: 429 }))
      .mockResolvedValueOnce(response({}, { status: 503 }))
      .mockResolvedValueOnce(response({ files: [] }));
    const client = new DriveClient(jest.fn(async () => 'token-1'), {
      fetchImpl: fetcher as unknown as typeof fetch,
      sleep,
    });

    await expect(client.findChild('folder-1', 'nota')).resolves.toBeUndefined();

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([1000, 3000]);
  });
});

describe('download', () => {
  it('recusa pelo Content-Length sem ler o corpo', async () => {
    const arrayBuffer = jest.fn(async () => new ArrayBuffer(0));
    const fetcher = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Map([['content-length', '2048']]),
      arrayBuffer,
    }) as unknown as Response);
    const client = makeClient(fetcher);

    await expect(client.download('file-1', 1024)).rejects.toMatchObject({
      kind: 'limit',
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('recusa pelo tamanho real quando o cabecalho nao veio', async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Map(),
      arrayBuffer: async () => new Uint8Array(2048).buffer,
    }) as unknown as Response);
    const client = makeClient(fetcher);

    await expect(client.download('file-1', 1024)).rejects.toMatchObject({
      kind: 'limit',
    });
  });

  it('devolve os bytes quando cabe no limite', async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Map([['content-length', '3']]),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }) as unknown as Response);
    const client = makeClient(fetcher);

    await expect(client.download('file-1', 1024)).resolves.toEqual(new Uint8Array([1, 2, 3]));
    const { url, init } = called(fetcher.mock.calls[0]);
    expect(url.toString()).toBe(`${API}/files/file-1?alt=media`);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-1');
  });
});

describe('put', () => {
  it('atualiza o arquivo existente por uploadType=media', async () => {
    const bytes = new Uint8Array([7, 8, 9]);
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(
        response({ files: [{ id: 'file-1', name: 'backup.enc', mimeType: 'application/octet-stream' }] }),
      )
      .mockResolvedValueOnce(response({ id: 'file-1', name: 'backup.enc', size: '3' }));
    const client = makeClient(fetcher);

    await expect(client.put('folder-1', 'backup.enc', bytes)).resolves.toEqual({
      id: 'file-1',
      name: 'backup.enc',
      size: '3',
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    const { url, init } = called(fetcher.mock.calls[1]);
    expect(url.toString().startsWith(`${UPLOAD}/files/file-1?`)).toBe(true);
    expect(url.searchParams.get('uploadType')).toBe('media');
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(bytes);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/octet-stream');
  });

  it('cria a metadata e depois sobe os bytes', async () => {
    const bytes = new Uint8Array([1]);
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(response({ files: [] }))
      .mockResolvedValueOnce(response({ id: 'file-2' }))
      .mockResolvedValueOnce(response({ id: 'file-2', name: 'key.txt' }));
    const client = makeClient(fetcher);

    await expect(client.put('folder-1', 'key.txt', bytes, 'text/plain')).resolves.toEqual({
      id: 'file-2',
      name: 'key.txt',
    });

    expect(fetcher).toHaveBeenCalledTimes(3);
    const create = called(fetcher.mock.calls[1]);
    expect(create.url.pathname.endsWith('/files')).toBe(true);
    expect(create.init.method).toBe('POST');
    expect(JSON.parse(String(create.init.body))).toEqual({
      name: 'key.txt',
      parents: ['folder-1'],
    });
    const upload = called(fetcher.mock.calls[2]);
    expect(upload.url.toString().startsWith(`${UPLOAD}/files/file-2?`)).toBe(true);
    expect(upload.url.searchParams.get('uploadType')).toBe('media');
    expect((upload.init.headers as Record<string, string>)['Content-Type']).toBe('text/plain');
  });

  it('recusa mais de 100 MiB antes de falar com o Drive', async () => {
    const fetcher = jest.fn(async () => response({}));
    const client = makeClient(fetcher);
    const grande = { length: 100 * 1024 * 1024 + 1 } as unknown as Uint8Array;

    await expect(client.put('folder-1', 'backup.enc', grande)).rejects.toMatchObject({
      kind: 'limit',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('erros', () => {
  it('nao vaza o corpo do erro do Drive', async () => {
    const fetcher = jest.fn(async () => ({
      ok: false,
      status: 500,
      headers: new Map(),
      text: async () => 'segredo do usuario',
      json: async () => ({ error: { message: 'segredo do usuario' } }),
    }) as unknown as Response);
    const client = makeClient(fetcher);

    const error = (await client.findChild('folder-1', 'nota').catch((caught) => caught)) as DriveError;

    expect(error).toBeInstanceOf(DriveError);
    expect(error.kind).toBe('http');
    expect(error.status).toBe(500);
    expect(error.message).not.toContain('segredo');
    expect(String(error.stack)).not.toContain('segredo');
  });

  it('falha de rede vira DriveError network, sem repetir', async () => {
    const fetcher = jest.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const client = makeClient(fetcher);

    const error = (await client.list('folder-1').catch((caught) => caught)) as DriveError;

    expect(error).toBeInstanceOf(DriveError);
    expect(error.kind).toBe('network');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
