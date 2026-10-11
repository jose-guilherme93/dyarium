import type {
  Analysis,
  Entry,
  ModelInfo,
  Note,
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

// getSetupState reports whether the first-run setup is still open. It is a
// public route, so it works before any token exists. Failures are treated as
// "no setup needed" so the normal token gate is shown instead.
export async function getSetupState(): Promise<{ required: boolean }> {
  try {
    const res = await fetch("/setup/state");
    if (!res.ok) {
      return { required: false };
    }
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    return { required: Boolean(body.required) };
  } catch {
    return { required: false };
  }
}

// claimSetup stores the operator-chosen token and closes the setup window.
export async function claimSetup(token: string): Promise<void> {
  const res = await fetch("/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (res.ok) {
    return;
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  throw new ApiError(body?.error?.message ?? "falha ao configurar", res.status, body?.error?.code);
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getToken()}`,
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (init?.body && !(init.body instanceof Blob)) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`/api/v1${path}`, { ...init, headers });
  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new ApiError(body?.error?.message ?? res.statusText, res.status, body?.error?.code);
  }
  return body as T;
}

export const api = {
  listEntries: () => request<{ entries: Entry[] }>("/entries"),
  getEntry: (id: string) => request<Entry>(`/entries/${id}`),
  getTranscript: (id: string) => request<Transcript>(`/entries/${id}/transcript`),
  getAnalysis: (id: string) => request<Analysis>(`/entries/${id}/analysis`),
  retranscribe: (id: string) => request<{ status: string }>(`/entries/${id}/retranscribe`, { method: "POST" }),
  cancel: (id: string) =>
    request<{ status: string; cancelled: string[] }>(`/entries/${id}/cancel`, { method: "POST" }),
  analyze: (id: string) => request<{ status: string }>(`/entries/${id}/analyze`, { method: "POST" }),
  deleteEntry: (id: string) => request<void>(`/entries/${id}`, { method: "DELETE" }),
  patchEntry: (id: string, patch: { title?: string }) =>
    request<{ status: string }>(`/entries/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  listNotes: (id: string) => request<{ notes: Note[] }>(`/entries/${id}/notes`),
  createNote: (id: string, title: string, document: unknown) =>
    request<Note>(`/entries/${id}/notes`, { method: "POST", body: JSON.stringify({ title, document }) }),
  updateNote: (id: string, title: string, document: unknown) =>
    request<{ status: string }>(`/notes/${id}`, { method: "PUT", body: JSON.stringify({ title, document }) }),
  listTags: () => request<{ tags: Tag[] }>("/tags"),
  createTag: (name: string, color: string) =>
    request<{ id: string }>("/tags", { method: "POST", body: JSON.stringify({ name, color }) }),
  getSettings: () => request<Settings>("/settings"),
  putSettings: (patch: Record<string, unknown>) =>
    request<{ status: string }>("/settings", { method: "PUT", body: JSON.stringify(patch) }),
  listModels: () => request<{ models: ModelInfo[] }>("/models"),
  downloadModel: (name: string) =>
    request<{ status: string }>("/models/download", { method: "POST", body: JSON.stringify({ name }) }),
};

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// uploadFile performs a resumable upload: create, PUT chunks by offset, complete.
export async function uploadFile(
  file: File,
  onProgress?: (sent: number, total: number) => void,
): Promise<{ entry_id: string }> {
  const buffer = await file.arrayBuffer();
  const sha256 = await sha256Hex(buffer);
  const start = await request<{ id: string }>("/uploads", {
    method: "POST",
    body: JSON.stringify({
      filename: file.name,
      content_type: file.type || "application/octet-stream",
      size_bytes: file.size,
      sha256,
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

  return request<{ entry_id: string }>(`/uploads/${start.id}/complete`, { method: "POST" });
}
