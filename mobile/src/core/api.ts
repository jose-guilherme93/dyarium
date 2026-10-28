/**
 * Cliente HTTP do servidor dyarium. O `fetch` e injetado para permitir testes
 * com um transporte falso. Nao ha estado aqui: cada chamada e independente.
 */

import type {
  AuthorRole, ConflictField, ServerAudio, ServerConfig, TranscriptSegment } from './types';

export type { ConflictField, ServerAudio, TranscriptSegment };

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
  /** Hora de criacao/importacao original da nota; imutavel no servidor. */
  created_at?: string;
  /** Origem: `share` para audio importado. */
  source?: 'upload' | 'share';
  /**
   * O cliente se responsabiliza pela transcricao (transcreve no aparelho ou
   * deixa a etapa desligada): o servidor nao enfileira nada.
   */
  local_transcribe?: boolean;
  /** O cliente se responsabiliza pela analise: o servidor nao enfileira. */
  local_analysis?: boolean;
  /** Quando presente, adiciona o audio a uma entrada existente. */
  entry_id?: string;
  /** Papel do autor escolhido na nota (self/other/mixed); vazio segue o padrao. */
  author?: AuthorRole;
}

export interface PutTranscriptBody {
  attachment_id?: string;
  language?: string;
  text: string;
  segments: TranscriptSegment[];
}

export interface PutTranscriptRevisionsBody {
  attachment_id?: string;
  model: string;
  prompt_version: number;
  literal: boolean;
  comprehension: number;
  /** Trechos que o modelo nao conseguiu revisar; o painel mostra o numero. */
  rejected?: number;
  /** Indice do primeiro trecho que a passada ainda nao alcancou. */
  reviewed_through?: number;
  segments: { idx: number; text: string }[];
}

export interface CreateTextEntryBody {
  /** Id temporal do app (ULID): o servidor usa-o para a nota manter a posicao. */
  id?: string;
  title: string;
  /** Data do evento; vira `recorded_at` da entrada. */
  recorded_at?: string;
  /** Hora de criacao/importacao original; o servidor nao a muda depois. */
  created_at?: string;
  notebook_id?: string;
  /** Papel do autor escolhido na nota; vazio segue o padrao do app. */
  author?: AuthorRole;
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
  /** Move a nota de caderno (ultima gravacao vence). */
  notebook_id?: string;
  /** Arquivada: sai da lista de trabalho sem apagar. */
  archived?: boolean;
  /** Papel do autor da nota (ultima gravacao vence). */
  author?: AuthorRole;
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
  /** Versoes atuais do servidor para os campos que brigaram. */
  readonly versions: Record<string, string>;
  constructor(
    status: number,
    code: string,
    message: string,
    fields: ConflictField[],
    versions: Record<string, string> = {},
  ) {
    super(status, code, message);
    this.name = 'ConflictError';
    this.fields = fields;
    this.versions = versions;
  }
}

/** Campos em conflito e versoes atuais do servidor, na resposta de um 409. */
interface ConflictBody {
  conflict?: ConflictField[];
  versions?: Record<string, string>;
}

/** Corpo de erro lido uma unica vez; o `text()` da Response nao pode repetir. */
interface ParsedError {
  error: ApiError;
  body: Record<string, unknown>;
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
  /** Id do audio original criado/reaproveitado no servidor. */
  attachment_id?: string;
  status: string;
  /** true quando o servidor encontrou um audio identico (dedupe). */
  duplicate?: boolean;
}

export interface TranscriptResponse {
  model: string;
  language: string;
  /** Texto visivel: o revisado quando existe, o cru do whisper quando nao. */
  text: string;
  /** Texto cru do whisper, preservado mesmo quando ha revisao. */
  raw_text?: string;
  trim_silence?: boolean;
  duration_seconds?: number;
  segments: TranscriptSegment[];
  /** Revisao ja aplicada no servidor, quando houver. */
  revised?: boolean;
  revised_model?: string;
  revised_prompt_version?: number;
  revised_literal?: boolean;
  revised_comprehension?: number;
  /** Trechos sem revisao porque o modelo nao conseguiu responder. */
  revised_rejected?: number;
  /** Trechos que a passada ainda nao alcancou; 0 quando terminou. */
  revised_pending?: number;
  /** Indice do primeiro trecho que a passada ainda nao alcancou. */
  revised_through?: number;
  /** A passada chegou ao fim (mesmo com recusas no caminho). */
  revised_finished?: boolean;
}

export interface VersionResponse {
  version: string;
  commit: string;
  built_at: string;
}

/** Envelope do snapshot de metricas enviado ao servidor. */
/** Agregado de execucoes de analise exposto pelo servidor (snake_case). */
export interface ServerAnalysisRunTotals {
  runs: number;
  ok: number;
  failed: number;
  fallback: number;
  success_rate: number;
  simplified_rate: number;
  avg_duration_ms: number;
  tokens_per_second: number;
}

export interface ServerAnalysisRunModel extends ServerAnalysisRunTotals {
  runtime: string;
  provider: string;
  model: string;
}

export interface ServerAnalysisRunsSummary {
  days: number;
  since: string;
  totals: ServerAnalysisRunTotals;
  models: ServerAnalysisRunModel[];
}

export interface MetricsUpload {
  device_id: string;
  device_name: string;
  schema: number;
  generated_at: string;
  /**
   * Secoes do documento, versionadas em docs/api.md: `writing` e `history` no
   * schema 1; `streak`, `windows` e `history` no schema 2.
   */
  [key: string]: unknown;
}

/** Entrada do servidor (resumo da lista). */
/** Tipo de entidade do mapa e da biblioteca. */
export type EntityKind = 'person' | 'place' | 'theme' | 'decision';

/** No do mapa de relacoes. `note` so aparece no modo foco. */
export interface GraphNode {
  id: string;
  kind: 'user' | EntityKind | 'note';
  label: string;
  /** Icone monocromatico escolhido no dashboard; vazio usa o do tipo. */
  icon?: string;
  mentions: number;
  notes: number;
  sentiment?: number;
  last_seen?: string | null;
  date?: string | null;
  author?: AuthorRole;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: 'relation' | 'cooccurrence' | 'mention';
  weight: number;
}

export interface GraphResponse {
  center: GraphNode;
  nodes: GraphNode[];
  edges: GraphEdge[];
  total_nodes: number;
  total_edges: number;
  truncated: boolean;
}

/** Pessoa, lugar, tema ou decisao agregada pelo servidor. */
export interface EntitySummary {
  id?: string;
  kind: EntityKind;
  name: string;
  /** Icone monocromatico; vazio segue o do tipo. */
  icon?: string;
  entries: number;
  mentions: number;
  sentiment: number;
  last_seen: string | null;
}

export interface EntityEntry {
  id: string;
  title: string;
  date: string | null;
  count: number;
}

export interface EntityDetail extends EntitySummary {
  entry_list: EntityEntry[];
}

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
  /** Caderno que possui a nota. */
  notebook_id?: string;
  /** Tags da nota (nomes), quando houver. */
  tags?: string[];
  /** Nota arquivada: sai da lista de trabalho sem ser apagada. */
  archived?: boolean;
  /** Papel do autor da nota; vazio segue o padrao do app. */
  author?: AuthorRole;
  /** Pilha de audios (so no detalhe da entrada), cada um com sua transcricao. */
  audios?: ServerAudio[];
  /** Primeiro audio original da entrada (a listagem traz so o id, nao a pilha). */
  primary_attachment_id?: string;
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
  /** Quem produziu: aparelho, este servidor ou um provedor de terceiro. */
  origin?: 'app' | 'server' | 'api';
  model: string;
  sentiment: number;
  sentiment_label?: string;
  emotions: Record<string, number> | null;
  people: string[] | null;
  places: string[] | null;
  summary: string;
  /** Leitura curta da IA: o que o texto revela, no maximo duas frases. */
  reading?: string | null;
  /** Analise secao por secao (titulos do texto e a transcricao). */
  sections?: ServerAnalysisSection[] | null;
  /** Compreensao logica (0 a 100); -1 ou ausente quando nao medida. */
  comprehension?: number;
  comprehension_source?: string;
  /** Series de fala por 100 palavras do texto cru. */
  stutter_rate?: number;
  hesitation_rate?: number;
  revised_segments?: number;
  /** Campos ricos, quando a analise foi feita com o pipeline novo. */
  themes?: AnalysisTheme[] | null;
  key_moments?: AnalysisMoment[] | null;
  questions?: string[] | null;
  decisions?: string[] | null;
}

export interface ServerAnalysisSection {
  heading: string;
  /** "text" para uma secao escrita, "transcript" para a fala. */
  kind: string;
  reading?: string;
  summary?: string;
  sentiment?: { score: number; label: string };
}

export interface ServerTag {
  id: string;
  name: string;
  color: string;
  entry_count: number;
}

export interface ServerNotebook {
  id: string;
  name: string;
  color: string;
  is_default: boolean;
  entry_count: number;
  last_entry_at?: string;
  created_at: string;
  updated_at: string;
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

  private async readError(res: HttpResponse): Promise<ParsedError> {
    let code = 'http_error';
    let message = `HTTP ${res.status}`;
    let offset: number | undefined;
    let body: Record<string, unknown> = {};
    try {
      const raw = await res.text();
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
      const envelope = body.error;
      if (envelope && typeof envelope === 'object') {
        const detail = envelope as { code?: unknown; message?: unknown };
        if (detail.code) code = String(detail.code);
        if (detail.message) message = String(detail.message);
      }
      if (typeof body.offset === 'number') offset = body.offset;
    } catch {
      // corpo nao-JSON: mantem a mensagem generica
    }
    return { error: new ApiError(res.status, code, message, offset), body };
  }

  private async parseError(res: HttpResponse): Promise<ApiError> {
    return (await this.readError(res)).error;
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

  /** Configuracao de autor da instancia (nome do dono e padrao das notas). */
  async getAuthorSettings(): Promise<{ owner_name: string; all_notes_mine: boolean }> {
    const res = await this.fetchImpl(this.url('/api/v1/settings'), {
      method: 'GET',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw await this.parseError(res);
    const parsed = JSON.parse(await res.text()) as {
      owner_name?: unknown;
      all_notes_mine?: unknown;
    };
    return {
      owner_name: typeof parsed.owner_name === 'string' ? parsed.owner_name : '',
      // Chave ausente numa instancia nova significa o padrao ligado.
      all_notes_mine: parsed.all_notes_mine !== false,
    };
  }

  /**
   * Mapa de relacoes (o dashboard desenha hoje; o app usa o mesmo contrato).
   * Sem `focus`, devolve o ego de entidades centrado no dono. O app ainda nao
   * tem a tela, mas o cliente ja fala o mesmo formato.
   */
  async getGraph(options: {
    notebookId?: string;
    from?: string;
    to?: string;
    focus?: string;
  } = {}): Promise<GraphResponse> {
    // Hermes nao traz URLSearchParams completo; montar a query a mao e seguro.
    const params: string[] = [];
    if (options.notebookId) params.push(`notebook_id=${encodeURIComponent(options.notebookId)}`);
    if (options.from) params.push(`from=${encodeURIComponent(options.from)}`);
    if (options.to) params.push(`to=${encodeURIComponent(options.to)}`);
    if (options.focus) params.push(`focus=${encodeURIComponent(options.focus)}`);
    const query = params.join('&');
    const res = await this.fetchImpl(this.url(`/api/v1/graph${query ? `?${query}` : ''}`), {
      method: 'GET',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw await this.parseError(res);
    return JSON.parse(await res.text()) as GraphResponse;
  }

  /**
   * Entidades do mapa. O app ainda nao tem a tela, mas o contrato e o mesmo do
   * dashboard: mesma entidade, mesmos aliases, mesmo icone.
   */
  async listEntities(kind?: EntityKind): Promise<EntitySummary[]> {
    const query = kind ? `?kind=${encodeURIComponent(kind)}` : '';
    const res = await this.fetchImpl(this.url(`/api/v1/entities${query}`), {
      method: 'GET',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw await this.parseError(res);
    const parsed = JSON.parse(await res.text()) as { entities?: EntitySummary[] };
    return parsed.entities ?? [];
  }

  async getEntity(kind: EntityKind, name: string): Promise<EntityDetail> {
    const res = await this.fetchImpl(
      this.url(`/api/v1/entities/${kind}/${encodeURIComponent(name)}`),
      { method: 'GET', headers: this.authHeaders() },
    );
    if (!res.ok) throw await this.parseError(res);
    return JSON.parse(await res.text()) as EntityDetail;
  }

  /** Renomeia; se o nome ja existe no mesmo tipo, as duas entidades mesclam. */
  async renameEntity(kind: EntityKind, name: string, nextName: string): Promise<EntitySummary> {
    const res = await this.fetchImpl(
      this.url(`/api/v1/entities/${kind}/${encodeURIComponent(name)}`),
      {
        method: 'PATCH',
        headers: this.authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name: nextName }),
      },
    );
    if (!res.ok) throw await this.parseError(res);
    return JSON.parse(await res.text()) as EntitySummary;
  }

  /** "Sou eu": funde a pessoa duplicada no dono do diario. */
  async claimSelf(name: string): Promise<{ status: string; owner: string }> {
    const res = await this.fetchImpl(
      this.url(`/api/v1/entities/person/${encodeURIComponent(name)}/self`),
      { method: 'POST', headers: this.authHeaders() },
    );
    if (!res.ok) throw await this.parseError(res);
    return JSON.parse(await res.text()) as { status: string; owner: string };
  }

  /** Troca o icone monocromatico; vazio volta ao icone do tipo. */
  async setEntityIcon(kind: EntityKind, name: string, icon: string): Promise<EntitySummary> {
    const res = await this.fetchImpl(
      this.url(`/api/v1/entities/${kind}/${encodeURIComponent(name)}/icon`),
      {
        method: 'PUT',
        headers: this.authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ icon }),
      },
    );
    if (!res.ok) throw await this.parseError(res);
    return JSON.parse(await res.text()) as EntitySummary;
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
  async createEntry(entry: {
    id: string;
    title: string;
    createdAt: string;
    notebookId?: string;
  }): Promise<{ id: string }> {
    const res = await this.fetchImpl(this.url('/api/v1/entries'), {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        id: entry.id,
        title: entry.title,
        created_at: entry.createdAt,
        notebook_id: entry.notebookId,
      }),
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
  async createNote(
    entryId: string,
    title: string,
    markdown: string,
    id?: string,
  ): Promise<ServerNote> {
    const res = await this.fetchImpl(this.url(`/api/v1/entries/${entryId}/notes`), {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ ...(id ? { id } : {}), title, content_markdown: markdown }),
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

  /**
   * Converte um 409 em ConflictError, dizendo os campos em conflito e as versoes
   * atuais do servidor. Le o corpo **uma vez**: uma Response nao pode ser lida
   * duas vezes, e a segunda leitura engolia a lista de campos.
   */
  private async parseErrorWithConflict(res: HttpResponse): Promise<ApiError> {
    const { error, body } = await this.readError(res);
    if (res.status !== 409) return error;
    const conflict = body as unknown as ConflictBody;
    const fields = Array.isArray(conflict.conflict)
      ? conflict.conflict.filter(
          (field): field is ConflictField =>
            field === 'title' || field === 'recorded_at' || field === 'body',
        )
      : [];
    const versions = conflict.versions && typeof conflict.versions === 'object'
      ? conflict.versions
      : {};
    return new ConflictError(res.status, error.code, error.message, fields, versions);
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

  /** Envia a revisao feita no aparelho para o dashboard ler o mesmo texto. */
  async putTranscriptRevisions(
    entryId: string,
    body: PutTranscriptRevisionsBody,
  ): Promise<void> {
    const res = await this.fetchImpl(
      this.url(`/api/v1/entries/${entryId}/transcript/revisions`),
      {
        method: 'PUT',
        headers: this.authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) throw await this.parseError(res);
  }

  /** Lista de entradas do servidor (resumo). `limit` alto para reconciliar. */
  async listEntries(limit = 100): Promise<ServerEntry[]> {
    return (await this.listEntriesPage(limit)).entries;
  }

  /**
   * Uma pagina da lista de entradas. `cursor` e o `next_cursor` da pagina
   * anterior; sem ele a pagina e a ultima. O pull percorre todas as paginas para
   * nao parar em silencio quando a biblioteca passa do limite.
   */
  async listEntriesPage(
    limit = 100,
    cursor?: string,
  ): Promise<{ entries: ServerEntry[]; next_cursor?: string }> {
    const params = `limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await this.fetchImpl(this.url(`/api/v1/entries?${params}`), {
      method: 'GET',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw await this.parseError(res);
    const body = JSON.parse(await res.text()) as {
      entries?: ServerEntry[];
      next_cursor?: string;
    };
    return { entries: body.entries ?? [], next_cursor: body.next_cursor };
  }

  /**
   * Entradas que o servidor confirma como apagadas (a lixeira). O app so remove
   * uma nota local por causa desta lista, nunca por ausencia: um servidor novo
   * (ou restaurado de um backup antigo) nao apaga o aparelho inteiro.
   */
  async listDeletedEntries(limit = 100): Promise<ServerEntry[]> {
    return (await this.listDeletedEntriesPage(limit)).entries;
  }

  /** Uma pagina da lixeira; mesma regra de `next_cursor` da lista de entradas. */
  async listDeletedEntriesPage(
    limit = 100,
    cursor?: string,
  ): Promise<{ entries: ServerEntry[]; next_cursor?: string }> {
    const params = `deleted=1&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await this.fetchImpl(this.url(`/api/v1/entries?${params}`), {
      method: 'GET',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw await this.parseError(res);
    const body = JSON.parse(await res.text()) as {
      entries?: ServerEntry[];
      next_cursor?: string;
    };
    return { entries: body.entries ?? [], next_cursor: body.next_cursor };
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

  /** Diagnostico das execucoes de analise do servidor. */
  async analysisRunsSummary(days = 30): Promise<ServerAnalysisRunsSummary> {
    const res = await this.fetchImpl(this.url(`/api/v1/analysis/runs/summary?days=${days}`), {
      method: 'GET',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw await this.parseError(res);
    return JSON.parse(await res.text());
  }

  /** Analise de uma entrada. Lanca ApiError 404 quando ainda nao existe. */
  /**
   * Envia a analise feita no aparelho. Sem `replace`, o servidor guarda so se
   * ainda nao tiver analise: o sync nunca sobrescreve o outro lado.
   */
  async putAnalysis(
    entryId: string,
    body: ServerAnalysis & { replace?: boolean },
  ): Promise<{ stored: boolean; origin?: string }> {
    const res = await this.fetchImpl(this.url(`/api/v1/entries/${entryId}/analysis`), {
      method: 'PUT',
      headers: this.authHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await this.parseError(res);
    return JSON.parse(await res.text());
  }

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

  /** Substitui as tags de uma entrada (a lista vazia limpa). */
  async setEntryTags(entryId: string, tags: string[]): Promise<void> {
    const res = await this.fetchImpl(this.url(`/api/v1/entries/${entryId}/tags`), {
      method: 'PUT',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ tags }),
    });
    if (!res.ok) throw await this.parseError(res);
  }

  /** Cadernos do servidor, na ordem de criacao (padrao no fim). */
  async listNotebooks(): Promise<ServerNotebook[]> {
    const res = await this.fetchImpl(this.url('/api/v1/notebooks'), {
      method: 'GET',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw await this.parseError(res);
    const body = JSON.parse(await res.text()) as { notebooks?: ServerNotebook[] };
    return body.notebooks ?? [];
  }

  /** Cria um caderno. O id do app (offline) e preservado quando enviado. */
  async createNotebook(notebook: {
    id?: string;
    name: string;
    color: string;
  }): Promise<ServerNotebook> {
    const res = await this.fetchImpl(this.url('/api/v1/notebooks'), {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(notebook),
    });
    if (!res.ok) throw await this.parseError(res);
    return JSON.parse(await res.text());
  }

  /** Renomeia e/ou recolore um caderno. */
  async updateNotebook(
    id: string,
    body: { name?: string; color?: string },
  ): Promise<ServerNotebook> {
    const res = await this.fetchImpl(this.url(`/api/v1/notebooks/${id}`), {
      method: 'PATCH',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await this.parseError(res);
    return JSON.parse(await res.text());
  }

  /** Exclui um caderno; o servidor move as notas para o padrao. */
  async deleteNotebook(id: string): Promise<void> {
    const res = await this.fetchImpl(this.url(`/api/v1/notebooks/${id}`), {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw await this.parseError(res);
  }

  /** Renomeia/recolore uma tag; um nome existente mescla as duas. */
  async updateTag(
    id: string,
    body: { name?: string; color?: string },
  ): Promise<{ id: string; name: string; color: string; merged: boolean }> {
    const res = await this.fetchImpl(this.url(`/api/v1/tags/${id}`), {
      method: 'PATCH',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await this.parseError(res);
    return JSON.parse(await res.text());
  }

  /** Exclui uma tag (some de todas as notas). */
  async deleteTag(id: string): Promise<void> {
    const res = await this.fetchImpl(this.url(`/api/v1/tags/${id}`), {
      method: 'DELETE',
      headers: this.authHeaders(),
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
