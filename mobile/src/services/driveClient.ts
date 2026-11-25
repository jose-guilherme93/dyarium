/**
 * Cliente REST do Google Drive para o backup do cofre no app.
 *
 * Escopo `drive.file`: o app so ve e toca nos arquivos que ele mesmo criou. O
 * cliente nao guarda token: recebe uma funcao que devolve o access token atual
 * e, no 401, pede a renovacao uma vez.
 *
 * Nenhum corpo de resposta do Drive vira mensagem de erro: status HTTP basta, e
 * o conteudo do cofre nunca aparece em log.
 */

export interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  modifiedTime?: string;
  size?: string;
}

export interface DriveClientOptions {
  /** Injetavel para teste; em producao e o `fetch` global. */
  fetchImpl?: typeof fetch;
  /** Injetavel para teste; em producao espera de verdade. */
  sleep?: (ms: number) => Promise<void>;
}

export type DriveErrorKind = 'config' | 'auth' | 'network' | 'http' | 'limit';

export class DriveError extends Error {
  readonly kind: DriveErrorKind;
  readonly status?: number;

  constructor(kind: DriveErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'DriveError';
    this.kind = kind;
    this.status = status;
  }
}

interface FileList {
  files?: DriveFile[];
  nextPageToken?: string;
}

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FILE_FIELDS = 'id,name,mimeType,modifiedTime,size';

const LIST_PAGE_SIZE = 1000;
/** Teto de seguranca: 100 mil arquivos cobrem qualquer cofre real. */
const MAX_LIST_PAGES = 100;
const RETRY_DELAYS_MS = [1000, 3000];
const MAX_PUT_BYTES = 100 * 1024 * 1024;

function escapeQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Espera padrao entre tentativas. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DriveClient {
  private readonly token: (forceRefresh?: boolean) => Promise<string>;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(token: (forceRefresh?: boolean) => Promise<string>, options: DriveClientOptions = {}) {
    this.token = token;
    // Chamada como `this.fetchImpl`, um `fetch` cru do global vira "illegal
    // invocation"; a seta preserva o receptor original.
    this.fetchImpl =
      options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
    this.sleepImpl = options.sleep ?? wait;
  }

  private failure(status: number): DriveError {
    if (status === 401) {
      return new DriveError('auth', 'o Google recusou a sessao do Drive', status);
    }
    return new DriveError('http', 'o Drive respondeu com erro', status);
  }

  /**
   * Uma requisicao autenticada. 401 pede token novo e repete uma unica vez;
   * 429 e 5xx esperam 1s e 3s entre as tres tentativas.
   */
  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    let refreshed = false;
    let retries = 0;
    let force = false;

    for (;;) {
      const token = await this.token(force);
      force = false;

      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          ...init,
          headers: {
            Authorization: `Bearer ${token}`,
            ...((init.headers ?? {}) as Record<string, string>),
          },
        });
      } catch {
        throw new DriveError('network', 'nao foi possivel falar com o Drive');
      }

      if (res.status === 401 && !refreshed) {
        refreshed = true;
        force = true;
        continue;
      }

      if ((res.status === 429 || res.status >= 500) && retries < RETRY_DELAYS_MS.length) {
        await this.sleepImpl(RETRY_DELAYS_MS[retries]);
        retries += 1;
        continue;
      }

      return res;
    }
  }

  private async json<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await this.request(url, init);
    if (!res.ok) throw this.failure(res.status);
    try {
      return (await res.json()) as T;
    } catch {
      throw new DriveError('http', 'o Drive devolveu uma resposta inesperada', res.status);
    }
  }

  /** Filho direto da pasta com esse nome, se existir. */
  async findChild(folderId: string, name: string): Promise<DriveFile | undefined> {
    const params = new URLSearchParams({
      q: [
        `name = '${escapeQuery(name)}'`,
        'trashed = false',
        `'${escapeQuery(folderId)}' in parents`,
      ].join(' and '),
      fields: `files(${FILE_FIELDS})`,
      spaces: 'drive',
      pageSize: '10',
    });
    const found = await this.json<FileList>(`${API}/files?${params.toString()}`);
    return found.files?.[0];
  }

  async list(folderId: string): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const params = new URLSearchParams({
        q: `'${escapeQuery(folderId)}' in parents and trashed = false`,
        spaces: 'drive',
        pageSize: String(LIST_PAGE_SIZE),
        fields: `nextPageToken,files(${FILE_FIELDS})`,
      });
      if (pageToken) params.set('pageToken', pageToken);

      const batch = await this.json<FileList>(`${API}/files?${params.toString()}`);
      out.push(...(batch.files ?? []));
      pageToken = batch.nextPageToken;
      if (!pageToken) break;
    }

    return out;
  }

  /** Pasta com esse nome, criada se faltar. Sem pai, fica na raiz do Drive. */
  async ensureFolder(name: string, parentId?: string): Promise<string> {
    const parent = parentId ?? 'root';
    const existing = await this.findChild(parent, name);
    if (existing && existing.mimeType === FOLDER_MIME) return existing.id;

    const created = await this.json<DriveFile>(`${API}/files?fields=${FILE_FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: FOLDER_MIME,
        ...(parentId ? { parents: [parentId] } : {}),
      }),
    });
    return created.id;
  }

  /**
   * Baixa os bytes do arquivo. O `Content-Length` e conferido antes de ler e o
   * tamanho real depois: um arquivo grande demais nao entra na memoria.
   */
  async download(fileId: string, maxBytes: number): Promise<Uint8Array> {
    const res = await this.request(`${API}/files/${encodeURIComponent(fileId)}?alt=media`);
    if (!res.ok) throw this.failure(res.status);

    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new DriveError('limit', 'o arquivo do Drive e grande demais', res.status);
    }

    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      throw new DriveError('limit', 'o arquivo do Drive e grande demais', res.status);
    }
    return new Uint8Array(buffer);
  }

  /**
   * Cria ou substitui o arquivo de mesmo nome na pasta. O nome do arquivo e o
   * conteudo nunca aparecem em mensagem de erro.
   */
  async put(
    folderId: string,
    name: string,
    bytes: Uint8Array,
    mimeType = 'application/octet-stream',
  ): Promise<DriveFile> {
    if (bytes.length > MAX_PUT_BYTES) {
      throw new DriveError('limit', 'o arquivo e grande demais para o Drive');
    }

    const existing = await this.findChild(folderId, name);
    let fileId = existing?.id;

    if (!fileId) {
      const created = await this.json<DriveFile>(`${API}/files?fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parents: [folderId] }),
      });
      fileId = created.id;
    }

    return this.json<DriveFile>(
      `${UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=${FILE_FIELDS}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': mimeType },
        body: bytes as unknown as BodyInit,
      },
    );
  }
}
