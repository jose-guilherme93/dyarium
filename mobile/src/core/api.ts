/**
 * Cliente HTTP do servidor dyarium. O `fetch` e injetado para permitir testes
 * com um transporte falso. Nao ha estado aqui: cada chamada e independente.
 */

import type { ConflictField, ServerConfig, TranscriptSegment } from './types';

export type { ConflictField, TranscriptSegment };

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
  /** O cliente transcreve no aparelho; o servidor nao enfileira transcricao. */
  local_transcribe?: boolean;
}

export interface PutTranscriptBody {
  attachment_id?: string;
  language?: string;
  text: string;
  segments: TranscriptSegment[];
}

export interface CreateTextEntryBody {
  /** Id temporal do app (ULID): o servidor usa-o para a nota manter a posicao. */
  id?: string;
  client_key: string;
  title: string;
  recorded_at?: string;
  created_at?: string;
  text: string;
}

export interface CreateTextEntryResponse {
  /** Id da entrada no servidor (o mesmo id temporal enviado pelo app). */
  id: string;
  status?: string;
  /** true quando o servidor encontrou um conteudo identico (dedupe). */
  duplicate?: boolean;
}

export interface UpdateEntryBody {
  title?: string;
  recorded_at?: string;
  /** Arquivada: sai da lista de trabalho sem apagar. */
  archived?: boolean;
  /** Versoes lidas pelo cliente: o servidor recusa o campo que ja mudou. */
  versions?: {
    title?: string;
    recorded_at?: string;
  };
}

/** Versoes devolvidas pelo servidor depois de gravar um campo. */
export interface FieldVersions {
  title: string;
  recorded_at: string;
}

/**
 * O servidor recusou a gravacao porque o campo ja mudou depois que o app leu
 * (409). Traz quais campos brigaram; **nada foi gravado**.
 */
export class ConflictError extends ApiError {
  readonly fields: ConflictField[];
  constructor(status: number, code: string, message: string, fields: ConflictField[]) {
    super(status, code, message);
    this.name = 'ConflictError';
    this.fields = fields;
  }
}

/** Campos em conflito e versoes atuais do servidor, na resposta de um 409. */
interface ConflictBody {
  conflict?: ConflictField[];
  versions?: Record<string, string>;
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

/** Envelope do snapshot de metricas enviado ao servidor. */
export interface MetricsUpload {
  device_id: string;
  device_name: string;
  schema: number;
  generated_at: string;
  /** Metricas de escrita (ver core/metricsSnapshot.ts e docs/api.md). */
  writing: unknown;
  /** Series do historico para os graficos do painel. */
  history: unknown;
}

/** Entrada do servidor (resumo da lista). */
export interface ServerEntry {
  id: string;
  title: string;
  status: string;
  source: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  duration_seconds: number;
  recorded_at: string | null;
  created_at: string;
  updated_at: string;
  /** Nota arquivada: sai da lista de trabalho sem ser apagada. */
  archived?: boolean;
  /** Pilha de audios (so no detalhe da entrada), cada um com sua transcricao. */
  audios?: ServerAudio[];
  /** Versao de cada campo (o servidor devolve tambem a do corpo). */
  versions?: { title?: string; recorded_at?: string; body?: string };
  /** Presente apenas na listagem da lixeira (`?deleted=1`). */
  deleted_at?: string | null;
}

export interface AnalysisTheme {
  name: string;
  confidence: number;
}

export interface AnalysisMoment {
  start_ms: number;
  text: string;
}

export interface ServerAnalysis {
  model: string;
  sentiment: number;
  sentiment_label?: string;
  emotions: Record<string, number> | null;
  people: string[] | null;
  places: string[] | null;
  summary: string;
  /** Campos ricos, quando a analise foi feita com o pipeline novo. */
  themes?: AnalysisTheme[] | null;
  key_moments?: AnalysisMoment[] | null;
  questions?: string[] | null;
  decisions?: string[] | null;
}

export interface ServerTag {
  id: string;
  name: string;
  color: string;
  entry_count: number;
}

/** Nota (corpo rico) de uma entrada. `document` e o JSON de blocos do BlockNote. */
export interface ServerNote {
  id: string;
  entry_id: string;
  title: string;
  /** Corpo em markdown (formato canonico dos dois lados). */
  content_markdown?: string;
  /** Versao do corpo (para o conflito ser detectado). */
  body_version?: string;
  created_at: string;
  updated_at: string;
}

/** Anexo de uma entrada (imagem anexada a nota). */
/** Um audio da nota, como o servidor guarda: uma nota pode ter varios. */
export interface ServerAudio {
  id: string;
  content_type: string;
  size_bytes: number;
  duration_seconds: number;
  created_at: string;
  transcript?: {
    text?: string;
    language?: string;
    segments?: TranscriptSegment[];
  };
}

export interface ServerAttachment {
  id: string;
  entry_id: string;
  kind: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
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
   * Cria uma nota somente texto. O servidor aceita o id temporal do app (ULID)
   * e a hora de criacao, e e idempotente por esse id. O texto do corpo vai no
   * documento da nota (via `createNote`/`updateNote`), nao aqui.
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
   * Cria a entrada com o id temporal do app (offline-first) e a hora de criacao,
   * para o servidor colocar a nota na posicao cronologica certa. O servidor e
   * idempotente: reenviar o mesmo id devolve a entrada existente.
   */
  async createEntry(entry: { id: string; title: string; createdAt: string }): Promise<{ id: string }> {
    const res = await this.fetchImpl(this.url('/api/v1/entries'), {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ id: entry.id, title: entry.title, created_at: entry.createdAt }),
    });
    if (!res.ok) throw await this.parseError(res);
    const body = JSON.parse(await res.text()) as { id?: string };
    return { id: String(body.id ?? '') };
  }

  /**
   * Atualiza titulo e data de uma entrada, com a versao lida de cada campo: o
   * servidor recusa (409) o campo que ja mudou em outro lugar. Devolve as
   * versoes gravadas, para a proxima gravacao comecar de la.
   */
  async updateEntry(id: string, body: UpdateEntryBody): Promise<FieldVersions> {
    const res = await this.fetchImpl(this.url(`/api/v1/entries/${id}`), {
      method: 'PATCH',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await this.parseErrorWithConflict(res);
    const parsed = JSON.parse(await res.text()) as { versions?: Partial<FieldVersions> };
    return {
      title: parsed.versions?.title ?? '',
      recorded_at: parsed.versions?.recorded_at ?? '',
    };
  }

  /** Notas (corpo rico) de uma entrada. */
  async listNotes(entryId: string): Promise<ServerNote[]> {
    const res = await this.fetchImpl(this.url(`/api/v1/entries/${entryId}/notes`), {
      method: 'GET',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw await this.parseError(res);
    const body = JSON.parse(await res.text()) as { notes?: ServerNote[] };
    return body.notes ?? [];
  }

  /** Entrada completa: titulo, data, versoes dos campos e a pilha de audios. */
  async getEntry(entryId: string): Promise<ServerEntry> {
    const res = await this.fetchImpl(this.url(`/api/v1/entries/${entryId}`), {
      method: 'GET',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw await this.parseError(res);
    return JSON.parse(await res.text());
  }

  /**
   * A pilha de audios da nota, do mais antigo para o mais novo. O app nao grava
   * varios audios numa nota (isso e do dashboard), mas **le** a pilha: e assim que
   * os audios do desktop aparecem aqui, cada um com a sua transcricao.
   */
  async listAudios(entryId: string): Promise<ServerAudio[]> {
    const entry = await this.getEntry(entryId);
    return (entry.audios ?? []) as ServerAudio[];
  }

  /** Cria a nota de uma entrada a partir do markdown do corpo. */
  async createNote(entryId: string, title: string, markdown: string): Promise<ServerNote> {
    const res = await this.fetchImpl(this.url(`/api/v1/entries/${entryId}/notes`), {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ title, content_markdown: markdown }),
    });
    if (!res.ok) throw await this.parseError(res);
    return JSON.parse(await res.text());
  }

  /**
   * Grava o corpo em markdown e devolve a versao nova. `baseVersion` e a versao
   * lida: se o servidor ja tiver mudado, ele responde 409 e o `ConflictError`
   * diz qual campo brigou (e nada e gravado).
   */
  async updateNote(noteId: string, markdown: string, baseVersion?: string): Promise<string> {
    const res = await this.fetchImpl(this.url(`/api/v1/notes/${noteId}`), {
      method: 'PUT',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        content_markdown: markdown,
        base_version: baseVersion ?? '',
      }),
    });
    if (!res.ok) throw await this.parseErrorWithConflict(res);
    const parsed = JSON.parse(await res.text()) as { versions?: { body?: string } };
    return parsed.versions?.body ?? '';
  }

  /** Converte um 409 em ConflictError, dizendo os campos em conflito. */
  private async parseErrorWithConflict(res: HttpResponse): Promise<ApiError> {
    const error = await this.parseError(res);
    if (res.status !== 409) return error;
    let fields: ConflictField[] = [];
    try {
      const body = (await res.text()) as unknown as ConflictBody;
      if (Array.isArray(body.conflict)) fields = body.conflict;
    } catch {
      // corpo nao-JSON: fica sem lista de campos
    }
    return new ConflictError(res.status, error.code, error.message, fields);
  }

  /** Sobe uma imagem como anexo da entrada (bytes crus, Content-Type image/*). */
  async uploadAttachment(
    entryId: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<ServerAttachment> {
    const res = await this.fetchImpl(this.url(`/api/v1/entries/${entryId}/attachments`), {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': contentType }),
      body: bytes,
    });
    if (!res.ok) throw await this.parseError(res);
    return JSON.parse(await res.text());
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

  /**
   * Envia a transcricao feita no aparelho. O servidor guarda como origem local
   * (nao transcreve de novo) e o dashboard passa a mostrar o texto.
   */
  async putTranscript(entryId: string, body: PutTranscriptBody): Promise<void> {
    const res = await this.fetchImpl(this.url(`/api/v1/entries/${entryId}/transcript`), {
      method: 'PUT',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await this.parseError(res);
  }

  /** Lista de entradas do servidor (resumo). `limit` alto para reconciliar. */
  async listEntries(limit = 100): Promise<ServerEntry[]> {
    const res = await this.fetchImpl(this.url(`/api/v1/entries?limit=${limit}`), {
      method: 'GET',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw await this.parseError(res);
    const body = JSON.parse(await res.text()) as { entries?: ServerEntry[] };
    return body.entries ?? [];
  }

  /**
   * Entradas que o servidor confirma como apagadas (a lixeira). O app so remove
   * uma nota local por causa desta lista, nunca por ausencia: um servidor novo
   * (ou restaurado de um backup antigo) nao apaga o aparelho inteiro.
   */
  async listDeletedEntries(limit = 100): Promise<ServerEntry[]> {
    const res = await this.fetchImpl(this.url(`/api/v1/entries?deleted=1&limit=${limit}`), {
      method: 'GET',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw await this.parseError(res);
    const body = JSON.parse(await res.text()) as { entries?: ServerEntry[] };
    return body.entries ?? [];
  }

  /** Desfaz a exclusao logica de uma entrada (traz de volta da lixeira). */
  async restoreEntry(id: string): Promise<ServerEntry> {
    const res = await this.fetchImpl(this.url(`/api/v1/entries/${id}/restore`), {
      method: 'POST',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw await this.parseError(res);
    return JSON.parse(await res.text());
  }

  /** Apaga a entrada no servidor (soft delete). */
  async deleteEntry(id: string): Promise<void> {
    const res = await this.fetchImpl(this.url(`/api/v1/entries/${id}`), {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw await this.parseError(res);
  }

  /** Analise de uma entrada. Lanca ApiError 404 quando ainda nao existe. */
  async getAnalysis(entryId: string): Promise<ServerAnalysis> {
    const res = await this.fetchImpl(this.url(`/api/v1/entries/${entryId}/analysis`), {
      method: 'GET',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw await this.parseError(res);
    return JSON.parse(await res.text());
  }

  /**
   * Envia o snapshot das metricas de escrita. O aparelho calcula tudo offline e
   * manda o documento pronto; o servidor guarda o ultimo de cada aparelho e o
   * painel web mostra os mesmos numeros.
   */
  async putMetrics(body: MetricsUpload): Promise<void> {
    const res = await this.fetchImpl(this.url('/api/v1/metrics'), {
      method: 'PUT',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await this.parseError(res);
  }

  /** Tags do servidor, com contagem de entradas. */
  async listTags(): Promise<ServerTag[]> {
    const res = await this.fetchImpl(this.url('/api/v1/tags'), {
      method: 'GET',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw await this.parseError(res);
    const body = JSON.parse(await res.text()) as { tags?: ServerTag[] };
    return body.tags ?? [];
  }
}
