/**
 * Cliente HTTP do servidor dyarium. O `fetch` e injetado para permitir testes
 * com um transporte falso. Nao ha estado aqui: cada chamada e independente.
 */

import type { ServerConfig } from './types';

export interface HttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export interface RequestInitLike {
  method?: string;
  headers?: Record<string, string>;
  body?: Uint8Array | string;
}

export type FetchLike = (input: string, init?: RequestInitLike) => Promise<HttpResponse>;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly offset?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface CreateUploadBody {
  client_key: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  duration_seconds?: number;
  sha256?: string;
  title?: string;
  recorded_at?: string;
  /** Texto da nota associado ao audio (o servidor passa a usar depois). */
  text?: string;
}

export interface CreateTextEntryBody {
  client_key: string;
  title: string;
  recorded_at?: string;
  text: string;
}

export interface CreateTextEntryResponse {
  entry_id: string;
  status: string;
  /** true quando o servidor encontrou um conteudo identico (dedupe). */
  duplicate?: boolean;
}

export interface UpdateEntryBody {
  title?: string;
  recorded_at?: string;
  /** Texto da nota (o servidor passa a usar depois). */
  text?: string;
}

export interface CreateUploadResponse {
  id: string;
  offset: number;
  expires_at: string;
}

export interface PutChunkResponse {
  id: string;
  offset: number;
  received_bytes: number;
}

export interface GetUploadResponse {
  id: string;
  status: string;
  offset: number;
  size_bytes: number;
  expires_at: string;
}

export interface CompleteUploadResponse {
  entry_id: string;
  status: string;
  /** true quando o servidor encontrou um audio identico (dedupe). */
  duplicate?: boolean;
}

export interface TranscriptSegment {
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface TranscriptResponse {
  model: string;
  language: string;
  text: string;
  trim_silence?: boolean;
  duration_seconds?: number;
  segments: TranscriptSegment[];
}

export interface VersionResponse {
  version: string;
  commit: string;
  built_at: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export class DyariumApi {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(
    config: ServerConfig,
    private readonly fetchImpl: FetchLike,
  ) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.token = config.token;
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    return { Authorization: `Bearer ${this.token}`, ...extra };
  }

  private async parseError(res: HttpResponse): Promise<ApiError> {
    let code = 'http_error';
    let message = `HTTP ${res.status}`;
    let offset: number | undefined;
    try {
      const raw = await res.text();
      const body = raw ? JSON.parse(raw) : {};
      if (body?.error?.code) code = String(body.error.code);
      if (body?.error?.message) message = String(body.error.message);
      if (typeof body?.offset === 'number') offset = body.offset;
    } catch {
      // corpo nao-JSON: mantem a mensagem generica
    }
    return new ApiError(res.status, code, message, offset);
  }

  /** Health check publico (sem autenticacao). */
  async healthz(): Promise<{ status: string; version: string }> {
    const res = await this.fetchImpl(this.url('/healthz'), { method: 'GET' });
    if (!res.ok) throw await this.parseError(res);
    return JSON.parse(await res.text());
  }

  /** Valida o token e a versao do servidor. */
  async version(): Promise<VersionResponse> {
    const res = await this.fetchImpl(this.url('/api/v1/version'), {
      method: 'GET',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw await this.parseError(res);
    return JSON.parse(await res.text());
  }

  async createUpload(body: CreateUploadBody): Promise<CreateUploadResponse> {
    const res = await this.fetchImpl(this.url('/api/v1/uploads'), {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await this.parseError(res);
    return JSON.parse(await res.text());
  }

  /**
   * Cria uma nota somente texto. O servidor ainda nao aceita este endpoint; a
   * chamada fica pronta no app para quando ele existir. O texto e tratado como
   * se fosse a transcricao da nota, mas marcado como nota de texto.
   */
  async createTextEntry(body: CreateTextEntryBody): Promise<CreateTextEntryResponse> {
    const res = await this.fetchImpl(this.url('/api/v1/entries'), {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await this.parseError(res);
    return JSON.parse(await res.text());
  }

  /**
   * Atualiza titulo/data/texto de uma entrada. O servidor ja aceita titulo e
   * data; o campo `text` sera usado quando a nota de texto for suportada.
   */
  async updateEntry(id: string, body: UpdateEntryBody): Promise<void> {
    const res = await this.fetchImpl(this.url(`/api/v1/entries/${id}`), {
      method: 'PATCH',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await this.parseError(res);
  }

  async putChunk(
    uploadId: string,
    offset: number,
    bytes: Uint8Array,
  ): Promise<PutChunkResponse> {
    const res = await this.fetchImpl(this.url(`/api/v1/uploads/${uploadId}`), {
      method: 'PUT',
      headers: this.authHeaders({
        'Content-Type': 'application/octet-stream',
        'X-Upload-Offset': String(offset),
      }),
      body: bytes,
    });
    if (!res.ok) throw await this.parseError(res);
    return JSON.parse(await res.text());
  }

  async getUpload(uploadId: string): Promise<GetUploadResponse> {
    const res = await this.fetchImpl(this.url(`/api/v1/uploads/${uploadId}`), {
      method: 'GET',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw await this.parseError(res);
    return JSON.parse(await res.text());
  }

  async completeUpload(uploadId: string): Promise<CompleteUploadResponse> {
    const res = await this.fetchImpl(this.url(`/api/v1/uploads/${uploadId}/complete`), {
      method: 'POST',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw await this.parseError(res);
    return JSON.parse(await res.text());
  }

  /** Transcricao da entrada. Lanca ApiError 404 enquanto nao estiver pronta. */
  async getTranscript(entryId: string): Promise<TranscriptResponse> {
    const res = await this.fetchImpl(this.url(`/api/v1/entries/${entryId}/transcript`), {
      method: 'GET',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw await this.parseError(res);
    return JSON.parse(await res.text());
  }
}
