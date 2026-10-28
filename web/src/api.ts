import { cacheGet, cacheSet } from "./lib/idb";
import { shrinkImage } from "./lib/image";
import { setOffline } from "./lib/offline";
import type {
  Activity,
  Analysis,
  Attachment,
  AuthorRole,
  EntityDetail,
  EntitySummary,
  Entry,
  GraphResponse,
  Link,
  LocalAnalysis,
  LocalAnalysisSetup,
  MetricsResponse,
  ModelInfo,
  MoodPoint,
  Note,
  Notebook,
  Revision,
  Segment,
  Settings,
  Tag,
  Transcript,
} from "./types";

const TOKEN_KEY = "dyarium.token";

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// verifyToken checks a bearer token against the API before it is stored. It
// returns true when the API accepts the token and false when it rejects it
// (401/403). Network or server failures throw so the caller can decide.
export async function verifyToken(token: string): Promise<boolean> {
  const res = await fetch("/api/v1/version", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.ok) {
    return true;
  }
  if (res.status === 401 || res.status === 403) {
    return false;
  }
  throw new ApiError(res.statusText || "falha ao validar o token", res.status);
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// memoryCache keeps the last GET payloads in memory so switching notes can
// paint instantly without even touching IndexedDB. IndexedDB holds the same
// values across reloads.
const memoryCache = new Map<string, string>();
// ETags are tiny; keeping them in memory avoids an IndexedDB round-trip before
// every revalidation.
const etagCache = new Map<string, string>();
// inflight deduplicates concurrent GETs for the same URL (the note loads four
// endpoints in parallel and fast note switching used to fire them twice).
const inflight = new Map<string, Promise<string>>();

async function readCache(url: string): Promise<string | undefined> {
  if (memoryCache.has(url)) {
    return memoryCache.get(url);
  }
  const cached = await cacheGet(url);
  if (cached !== undefined) {
    memoryCache.set(url, cached);
  }
  return cached;
}

function writeCache(url: string, text: string): void {
  memoryCache.set(url, text);
  void cacheSet(url, text);
}

/**
 * cachedGet returns the last cached copy of a GET without touching the network.
 * Views use it for the first paint and then let the normal request revalidate
 * in the background.
 */
export async function cachedGet<T>(path: string): Promise<T | undefined> {
  const text = await readCache(`/api/v1${path}`);
  if (text === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

async function getText(url: string, headers: Record<string, string>): Promise<string> {
  const pending = inflight.get(url);
  if (pending) {
    return pending;
  }
  const run = (async () => {
    const cached = await readCache(url);
    const etag = etagCache.get(url) || (await cacheGet(`etag:${url}`)) || "";
    if (etag) {
      etagCache.set(url, etag);
    }
    try {
      const requestHeaders = etag ? { ...headers, "If-None-Match": etag } : headers;
      const res = await fetch(url, { headers: requestHeaders });
      if (res.status === 304) {
        setOffline(false);
        if (cached !== undefined) {
          return cached;
        }
        // The validator survived but the body did not: fetch it again without
        // the conditional header.
        const retry = await fetch(url, { headers });
        const text = await retry.text();
        if (!retry.ok) {
          throw new ApiError(retry.statusText, retry.status);
        }
        writeCache(url, text);
        return text;
      }
      let response = res;
      // 502/503/504 costumam ser o proxy falando com um servidor que acabou de
      // reiniciar (deploy ou hot reload). Uma segunda tentativa curta evita
      // mostrar "bad gateway" em algo que ja voltou.
      if (response.status === 502 || response.status === 503 || response.status === 504) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        response = await fetch(url, { headers: requestHeaders });
      }
      const text = await response.text();
      if (!response.ok) {
        // O proxy pode devolver HTML no erro; nao deixe isso virar erro de JSON.
        let body: { error?: { message?: string; code?: string } } | null = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = null;
        }
        throw new ApiError(
          body?.error?.message ?? response.statusText,
          response.status,
          body?.error?.code,
        );
      }
      setOffline(false);
      writeCache(url, text);
      const next = res.headers.get("ETag");
      if (next) {
        etagCache.set(url, next);
        void cacheSet(`etag:${url}`, next);
      }
      return text;
    } catch (err) {
      // Serve the last cached copy when the network is unavailable.
      if (!(err instanceof ApiError) && cached !== undefined) {
        setOffline(true);
        return cached;
      }
      throw err;
    }
  })();
  inflight.set(url, run);
  try {
    return await run;
  } finally {
    inflight.delete(url);
  }
}

/**
 * Envia uma escrita e devolve tambem o status HTTP. O import do Notion usa o
 * 200/201 de `POST /entries` para distinguir uma entrada nova de uma que ja
 * existia sem precisar de uma leitura extra.
 */
async function mutate<T>(path: string, init?: RequestInit): Promise<{ data: T; status: number }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getToken()}`,
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (init?.body && !(init.body instanceof Blob)) {
    headers["Content-Type"] = "application/json";
  }
  const url = `/api/v1${path}`;
  const res = await fetch(url, { ...init, headers });
  if (res.status === 204) {
    setOffline(false);
    return { data: undefined as T, status: res.status };
  }
  const text = await res.text();
  if (!res.ok) {
    const body = text ? JSON.parse(text) : {};
    // 409 e conflito de edicao, não erro: o chamador precisa saber qual campo
    // brigou para oferecer a escolha ao usuario.
    if (res.status === 409) {
      throw new ConflictError(body?.error?.message ?? "a nota mudou no outro lugar", body?.conflict ?? []);
    }
    throw new ApiError(body?.error?.message ?? res.statusText, res.status, body?.error?.code);
  }
  setOffline(false);
  return { data: (text ? JSON.parse(text) : {}) as T, status: res.status };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const isGet = method === "GET";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getToken()}`,
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (init?.body && !(init.body instanceof Blob)) {
    headers["Content-Type"] = "application/json";
  }
  const url = `/api/v1${path}`;
  if (isGet) {
    const text = await getText(url, headers);
    return (text ? JSON.parse(text) : {}) as T;
  }
  return (await mutate<T>(path, init)).data;
}

export interface EntryFilters {
  person?: string;
  place?: string;
  theme?: string;
  /** Restringe a um caderno. */
  notebook_id?: string;
  /** Teto de entradas (o servidor limita a 5000). */
  limit?: number;
  /** Offset da pagina anterior (`next_cursor` da resposta). */
  cursor?: string;
  /** `true` so as arquivadas, `false` so as da lista de trabalho. */
  archived?: boolean;
}

/** Campo que briguou quando o servidor recusou a gravacao. */
export type ConflictField = "title" | "recorded_at" | "body";

/** O servidor recusou a gravacao porque o campo ja mudou (409). Nada foi gravado. */
export class ConflictError extends Error {
  readonly fields: ConflictField[];

  constructor(message: string, fields: ConflictField[]) {
    super(message);
    this.name = "ConflictError";
    this.fields = fields;
  }
}

/** `true` quando o erro e um conflito de edicao (409). */
export function isConflict(error: unknown): error is ConflictError {
  return error instanceof ConflictError;
}

function entriesPath(filters?: EntryFilters): string {
  const params = new URLSearchParams();
  if (filters?.person) {
    params.set("person", filters.person);
  }
  if (filters?.place) {
    params.set("place", filters.place);
  }
  if (filters?.theme) {
    params.set("theme", filters.theme);
  }
  if (filters?.notebook_id) {
    params.set("notebook_id", filters.notebook_id);
  }
  if (filters?.limit) {
    params.set("limit", String(filters.limit));
  }
  if (filters?.cursor) {
    params.set("cursor", filters.cursor);
  }
  // Sem filtro o servidor traz as duas listas. O dashboard abre na lista de
  // trabalho; as arquivadas ficam na aba delas.
  if (filters?.archived !== undefined) {
    params.set("archived", filters.archived ? "1" : "0");
  }
  const query = params.toString();
  return `/entries${query ? `?${query}` : ""}`;
}

// analysisMisses remembers entries that answered 404 for analysis in this
// session, so reopening the note does not pay another round-trip for a note
// that has no analysis yet. A new analyze request clears it.
const analysisMisses = new Set<string>();

async function requestAnalysis(id: string): Promise<Analysis> {
  if (analysisMisses.has(id)) {
    throw new ApiError("Sem análise ainda.", 404, "not_found");
  }
  try {
    return await request<Analysis>(`/entries/${id}/analysis`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      analysisMisses.add(id);
    }
    throw err;
  }
}

export const api = {
  listEntries: (filters?: EntryFilters) =>
    request<{ entries: Entry[]; next_cursor?: string }>(entriesPath(filters)),
  /** Todas as paginas, para a lista não parar em silêncio no limite do servidor. */
  listAllEntries: async (filters?: EntryFilters) => {
    const entries: Entry[] = [];
    let cursor: string | undefined;
    // Um teto de seguranca: 20 paginas de 1000 ja cobrem qualquer biblioteca
    // pessoal e evitam um laco infinito se o servidor repetir o cursor.
    for (let page = 0; page < 20; page += 1) {
      const result = await request<{ entries: Entry[]; next_cursor?: string }>(
        entriesPath({ ...filters, limit: 1000, cursor }),
      );
      entries.push(...(result.entries ?? []));
      cursor = result.next_cursor;
      if (!cursor) break;
    }
    return { entries };
  },
  listEntriesCached: (filters?: EntryFilters) => cachedGet<{ entries: Entry[] }>(entriesPath(filters)),
  createEntry: (title: string, parentId?: string | null, notebookId?: string) =>
    request<Entry>("/entries", {
      method: "POST",
      body: JSON.stringify({
        title,
        ...(parentId ? { parent_id: parentId } : {}),
        ...(notebookId ? { notebook_id: notebookId } : {}),
      }),
    }),
  /**
   * Cria uma entrada de importacao com id deterministico e a data original.
   * `created` vem do 201; 200 significa que o id ja existia (reimportacao).
   */
  createImportEntry: async (input: {
    id: string;
    title: string;
    notebookId?: string;
    recordedAt?: string;
  }): Promise<{ entry: Entry; created: boolean }> => {
    const { data, status } = await mutate<Entry>("/entries", {
      method: "POST",
      body: JSON.stringify({
        id: input.id,
        title: input.title,
        ...(input.notebookId ? { notebook_id: input.notebookId } : {}),
        ...(input.recordedAt ? { recorded_at: input.recordedAt } : {}),
      }),
    });
    return { entry: data, created: status === 201 };
  },
  getEntry: (id: string) => request<Entry>(`/entries/${id}`),
  /** Última copia em cache da entrada, para a primeira pintura. */
  getEntryCached: (id: string) => cachedGet<Entry>(`/entries/${id}`),
  getTranscript: (id: string) => request<Transcript>(`/entries/${id}/transcript`),
  /** Uma pagina de segmentos; usada so ao expandir a transcrição. */
  listSegments: (entryId: string, attachmentId: string, cursor?: string) => {
    const params = new URLSearchParams({ attachment_id: attachmentId, limit: "500" });
    if (cursor) {
      params.set("cursor", cursor);
    }
    return request<{ segments: Segment[]; next_cursor?: string }>(
      `/entries/${entryId}/segments?${params.toString()}`,
    );
  },
  getAnalysis: (id: string) => requestAnalysis(id),
  getAnalysisCached: (id: string) => cachedGet<Analysis>(`/entries/${id}/analysis`),
  /** Esquece o 404 em cache depois de uma análise nova. */
  invalidateAnalysis: (id: string) => {
    analysisMisses.delete(id);
  },
  retranscribe: (id: string) => request<{ status: string }>(`/entries/${id}/retranscribe`, { method: "POST" }),
  cancel: (id: string) =>
    request<{ status: string; cancelled: string[] }>(`/entries/${id}/cancel`, { method: "POST" }),
  analyze: (id: string) => {
    analysisMisses.delete(id);
    return request<{ status: string }>(`/entries/${id}/analyze`, { method: "POST" });
  },
  deleteEntry: (id: string) => request<void>(`/entries/${id}`, { method: "DELETE" }),
  /** Lixeira: entradas apagadas, com `deleted_at`, da mais recente para a mais antiga. */
  listDeletedEntries: async () => {
    const entries: Entry[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const query = new URLSearchParams({ deleted: "1", limit: "500" });
      if (cursor) query.set("cursor", cursor);
      const result = await request<{ entries: Entry[]; next_cursor?: string }>(`/entries?${query}`);
      entries.push(...(result.entries ?? []));
      cursor = result.next_cursor;
      if (!cursor) break;
    }
    return { entries };
  },
  /** Desfaz a remocao logica. Idempotente. */
  restoreEntry: (id: string) => request<Entry>(`/entries/${id}/restore`, { method: "POST" }),
  /**
   * Atualiza titulo/data/arquivamento com a versao lida de cada campo: o
   * servidor recusa (409) o campo que ja mudou no celular.
   */
  patchEntry: (
    id: string,
    patch: {
      title?: string;
      recorded_at?: string;
      notebook_id?: string;
      archived?: boolean;
      author?: AuthorRole;
      versions?: { title?: string; recorded_at?: string };
    },
  ) => request<{ status: string; versions: { title?: string; recorded_at?: string } }>(
    `/entries/${id}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  ),
  listNotes: (id: string) => request<{ notes: Note[] }>(`/entries/${id}/notes`),
  listNotesCached: (id: string) => cachedGet<{ notes: Note[] }>(`/entries/${id}/notes`),
  /** Cria a nota a partir do markdown do corpo. */
  createNote: (id: string, title: string, markdown: string) =>
    request<Note>(`/entries/${id}/notes`, {
      method: "POST",
      body: JSON.stringify({ title, content_markdown: markdown }),
    }),
  /**
   * Grava o corpo em markdown. `baseVersion` e a versao lida: se o corpo ja
   * mudou no celular, o servidor responde 409 sem gravar nada.
   */
  updateNote: (id: string, markdown: string, baseVersion?: string) =>
    request<{ status: string; versions: { body?: string } }>(`/notes/${id}`, {
      method: "PUT",
      body: JSON.stringify({ content_markdown: markdown, base_version: baseVersion ?? "" }),
    }),
  listRevisions: (noteId: string, cursor?: string) => {
    const params = new URLSearchParams({ limit: "50" });
    if (cursor) {
      params.set("cursor", cursor);
    }
    return request<{ revisions: Revision[]; next_cursor?: string }>(`/notes/${noteId}/revisions?${params.toString()}`);
  },
  listTags: () => request<{ tags: Tag[] }>("/tags"),
  listEntryTags: (entryId: string) => request<{ tags: Tag[] }>(`/entries/${entryId}/tags`),
  setEntryTags: (entryId: string, tags: string[]) =>
    request<{ status: string }>(`/entries/${entryId}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tags }),
    }),
  createTag: (name: string, color: string) =>
    request<{ id: string }>("/tags", { method: "POST", body: JSON.stringify({ name, color }) }),
  updateTag: (id: string, patch: { name?: string; color?: string }) =>
    request<{ id: string; name: string; color: string; merged: boolean }>(`/tags/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteTag: (id: string) => request<void>(`/tags/${id}`, { method: "DELETE" }),
  listNotebooks: () => request<{ notebooks: Notebook[] }>("/notebooks"),
  createNotebook: (notebook: { id?: string; name: string; color: string }) =>
    request<Notebook>("/notebooks", { method: "POST", body: JSON.stringify(notebook) }),
  updateNotebook: (id: string, patch: { name?: string; color?: string }) =>
    request<Notebook>(`/notebooks/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteNotebook: (id: string) =>
    request<void>(`/notebooks/${id}`, { method: "DELETE" }),
  getSettings: () => request<Settings>("/settings"),
  putSettings: (patch: Record<string, unknown>) =>
    request<{ status: string }>("/settings", { method: "PUT", body: JSON.stringify(patch) }),
  listModels: () => request<{ models: ModelInfo[] }>("/models"),
  downloadModel: (name: string) =>
    request<{ status: string }>("/models/download", { method: "POST", body: JSON.stringify({ name }) }),
  listAnalyzeModels: () => request<{ models: string[] }>("/analyze/models"),
  /** Estado do Ollama local: no ar, modelos instalados e download em curso. */
  getLocalAnalysis: () => request<LocalAnalysis>("/analyze/local"),
  /** Um clique: configura o Ollama local e baixa o modelo se faltar. */
  setupLocalAnalysis: (model: string) =>
    request<LocalAnalysisSetup>("/analyze/local", { method: "POST", body: JSON.stringify({ model }) }),
  listEntities: (kind?: string) =>
    request<{ entities: EntitySummary[] }>(`/entities${kind ? `?kind=${encodeURIComponent(kind)}` : ""}`),
  getEntity: (kind: string, name: string) =>
    request<EntityDetail>(`/entities/${kind}/${encodeURIComponent(name)}`),
  /** Renomeia pessoa, lugar, tema ou decisao; o nome antigo vira alias. */
  renameEntity: (kind: string, name: string, nextName: string) =>
    request<EntitySummary>(`/entities/${kind}/${encodeURIComponent(name)}`, {
      method: "PATCH",
      body: JSON.stringify({ name: nextName }),
    }),
  /** Troca o icone monocromatico de uma entidade; vazio volta ao do tipo. */
  setEntityIcon: (kind: string, name: string, icon: string) =>
    request<EntitySummary>(`/entities/${kind}/${encodeURIComponent(name)}/icon`, {
      method: "PUT",
      body: JSON.stringify({ icon }),
    }),
  /** "Sou eu": funde a pessoa com o dono e usa o nome das configuracoes. */
  claimSelf: (name: string) =>
    request<{ status: string; owner: string }>(
      `/entities/person/${encodeURIComponent(name)}/self`,
      { method: "POST" },
    ),
  getMood: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) {
      params.set("from", from);
    }
    if (to) {
      params.set("to", to);
    }
    const query = params.toString();
    return request<{ mood: MoodPoint[] }>(`/mood${query ? `?${query}` : ""}`);
  },
  /** Mapa de relacoes: ego de entidades ou uma entidade expandida (`focus`). */
  getGraph: (options: {
    notebookId?: string;
    from?: string;
    to?: string;
    focus?: string;
  } = {}) => {
    const params = new URLSearchParams();
    if (options.notebookId) params.set("notebook_id", options.notebookId);
    if (options.from) params.set("from", options.from);
    if (options.to) params.set("to", options.to);
    if (options.focus) params.set("focus", options.focus);
    const query = params.toString();
    return request<GraphResponse>(`/graph${query ? `?${query}` : ""}`);
  },
  getMetrics: () => request<MetricsResponse>("/metrics"),
  /** Processos concluidos (transcricoes e analises), do mais recente ao antigo. */
  listActivities: () => request<{ activities: Activity[] }>("/activities"),
  listAttachments: (entryId: string) =>
    request<{ attachments: Attachment[] }>(`/entries/${entryId}/attachments`),
  listAttachmentsCached: (entryId: string) =>
    cachedGet<{ attachments: Attachment[] }>(`/entries/${entryId}/attachments`),
  deleteAttachment: (id: string) => request<void>(`/attachments/${id}`, { method: "DELETE" }),
  createLink: (entryId: string, body: { to_entry_id?: string; url?: string; label?: string }) =>
    request<Link>(`/entries/${entryId}/links`, { method: "POST", body: JSON.stringify(body) }),
};

// audioUrl builds a playable URL for the decrypted original audio. The token
// goes in the query because an <audio> element cannot set headers.
export function audioUrl(entryId: string): string {
  return `/api/v1/entries/${entryId}/audio?token=${encodeURIComponent(getToken())}`;
}

export function attachmentUrl(id: string): string {
  return `/api/v1/attachments/${id}?token=${encodeURIComponent(getToken())}`;
}

// uploadAttachment stores an image attached to an entry. Photos are shrunk in
// the browser first: the server has no thumbnail pipeline, so the stored bytes
// are what every note open has to decrypt.
export async function uploadAttachment(entryId: string, file: File): Promise<Attachment> {
  const upload = await shrinkImage(file);
  const res = await fetch(`/api/v1/entries/${entryId}/attachments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "Content-Type": upload.type || "application/octet-stream",
    },
    body: upload,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new ApiError(body?.error?.message ?? res.statusText, res.status, body?.error?.code);
  }
  return body as Attachment;
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// uploadFile performs a resumable upload: create, PUT chunks by offset, complete.
// When entryId is given the audio is added to that entry instead of creating a
// new one.
export async function uploadFile(
  file: File,
  onProgress?: (sent: number, total: number) => void,
  entryId?: string,
): Promise<{ entry_id: string; attachment_id: string }> {
  const buffer = await file.arrayBuffer();
  const sha256 = await sha256Hex(buffer);
  const start = await request<{ id: string }>("/uploads", {
    method: "POST",
    body: JSON.stringify({
      filename: file.name,
      content_type: file.type || "application/octet-stream",
      size_bytes: file.size,
      sha256,
      ...(entryId ? { entry_id: entryId } : {}),
    }),
  });

  const chunkSize = 4 * 1024 * 1024;
  let offset = 0;
  while (offset < file.size) {
    const chunk = file.slice(offset, offset + chunkSize);
    const res = await fetch(`/api/v1/uploads/${start.id}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${getToken()}`,
        "X-Upload-Offset": String(offset),
      },
      body: chunk,
    });
    if (!res.ok) {
      throw new ApiError("falha ao enviar o audio", res.status);
    }
    const body = (await res.json()) as { offset: number };
    offset = body.offset;
    onProgress?.(offset, file.size);
  }

  return request<{ entry_id: string; attachment_id: string }>(`/uploads/${start.id}/complete`, { method: "POST" });
}
