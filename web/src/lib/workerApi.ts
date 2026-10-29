/**
 * Protocolo do worker do navegador com o servidor.
 *
 * Diferente do resto do dashboard, estas chamadas nao passam pelo cache de GET:
 * a fila muda a cada segundo e uma resposta velha faria o worker reservar duas
 * vezes o mesmo trabalho. O token vai no header, nunca na URL.
 */

import { ApiError, getToken } from "../api";
import type { Entry, Note, Transcript } from "../types";

export interface WorkerJob {
  id: string;
  type: "transcribe" | "analyze";
  payload: { entry_id?: string; attachment_id?: string };
  attempts: number;
  max_attempts: number;
  lease_seconds: number;
}

export interface WorkerPresence {
  id: string;
  kind: string;
  tier: number;
  prefer_client: boolean;
  models: string[];
  current_job: string;
  last_seen: string;
}

export interface WorkerStatus {
  workers: WorkerPresence[];
  preferred: boolean;
  ttl_seconds: number;
  queue: Record<string, number>;
}

export interface RegisterInput {
  workerId: string;
  tier: number;
  preferClient: boolean;
  models: string[];
  caps?: unknown;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getToken()}`,
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`/api/v1${path}`, { ...init, headers });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as { error?: { message?: string; code?: string } }) : {};
  if (!res.ok) {
    throw new ApiError(
      body?.error?.message ?? res.statusText,
      res.status,
      body?.error?.code,
    );
  }
  return body as T;
}

export const workerApi = {
  register: (input: RegisterInput) =>
    call<{ worker: WorkerPresence; ttl_seconds: number }>("/worker/register", {
      method: "POST",
      body: JSON.stringify({
        worker_id: input.workerId,
        kind: "browser",
        tier: input.tier,
        prefer_client: input.preferClient,
        models: input.models,
        caps: input.caps ?? null,
      }),
    }),
  heartbeat: (workerId: string, jobId: string) =>
    call<{ ok: boolean; lost: boolean }>("/worker/heartbeat", {
      method: "POST",
      body: JSON.stringify({ worker_id: workerId, job_id: jobId }),
    }),
  claim: (workerId: string, leaseSeconds: number, entryId?: string, onlyEntry = false) =>
    call<{ job: WorkerJob | null }>("/worker/claim", {
      method: "POST",
      body: JSON.stringify({
        worker_id: workerId,
        lease_seconds: leaseSeconds,
        types: ["transcribe", "analyze"],
        ...(entryId ? { entry_id: entryId } : {}),
        ...(entryId && onlyEntry ? { only_entry: true } : {}),
      }),
    }),
  complete: (workerId: string, jobId: string) =>
    call<{ ok: boolean; lost: boolean }>("/worker/complete", {
      method: "POST",
      body: JSON.stringify({ worker_id: workerId, job_id: jobId }),
    }),
  fail: (workerId: string, jobId: string, message: string) =>
    call<{ ok: boolean; lost: boolean; final: boolean }>("/worker/fail", {
      method: "POST",
      body: JSON.stringify({ worker_id: workerId, job_id: jobId, error: message }),
    }),
  /** Devolve o job para a fila: o servidor assume a nota na hora. */
  release: (workerId: string, jobId: string) =>
    call<{ ok: boolean; lost: boolean }>("/worker/release", {
      method: "POST",
      body: JSON.stringify({ worker_id: workerId, job_id: jobId }),
    }),
  unregister: (workerId: string) =>
    call<{ ok: boolean }>("/worker/unregister", {
      method: "POST",
      body: JSON.stringify({ worker_id: workerId }),
    }),
  /**
   * Aviso de saida da aba: o `fetch` normal e cancelado quando a pagina
   * descarrega; com `keepalive` a mensagem chega e o servidor libera o job sem
   * esperar o lease vencer.
   */
  unregisterOnExit: (workerId: string) => {
    try {
      void fetch("/api/v1/worker/unregister", {
        method: "POST",
        keepalive: true,
        headers: {
          Authorization: `Bearer ${getToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ worker_id: workerId }),
      });
    } catch {
      // A pagina ja esta indo embora; o lease de 120 s cobre a falha.
    }
  },
  status: () => call<WorkerStatus>("/worker/status"),
};

/** Baixa o audio decifrado em streaming. Autenticado por header. */
export async function fetchAudio(attachmentId: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const res = await fetch(`/api/v1/attachments/${attachmentId}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
    // O audio decifrado nao fica no cache HTTP do navegador: o worker so
    // precisa dele enquanto a nota esta sendo transcrita.
    cache: "no-store",
    signal,
  });
  if (!res.ok) {
    throw new ApiError("audio indisponivel", res.status);
  }
  return res.arrayBuffer();
}

export interface EntryBundle {
  entry: Entry;
  note: string;
  title: string;
  transcript: Transcript | null;
}

/** Tudo o que a analise precisa ler, em uma passada. */
export async function fetchEntryBundle(entryId: string): Promise<EntryBundle> {
  const [entry, notes] = await Promise.all([
    call<Entry>(`/entries/${entryId}`),
    call<{ notes: Note[] }>(`/entries/${entryId}/notes`).catch(() => ({ notes: [] })),
  ]);
  let transcript: Transcript | null = null;
  try {
    transcript = await call<Transcript>(`/entries/${entryId}/transcript`);
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }
  const note = (notes.notes ?? [])
    .map((item) => item.content_markdown ?? "")
    .filter((text) => text.trim() !== "")
    .join("\n\n");
  return { entry, note, title: entry.title || "", transcript };
}

export interface TranscriptPayload {
  attachment_id: string;
  language: string;
  text: string;
  segments: { start_ms: number; end_ms: number; text: string }[];
}

export async function saveTranscript(entryId: string, payload: TranscriptPayload): Promise<void> {
  await call<{ model: string }>(`/entries/${entryId}/transcript`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export interface AnalysisDevice {
  id: string;
  name: string;
}

export async function saveAnalysis(
  entryId: string,
  payload: Record<string, unknown>,
  replace = false,
  device?: AnalysisDevice,
): Promise<{ stored: boolean; origin?: string }> {
  return call<{ stored: boolean; origin?: string }>(`/entries/${entryId}/analysis`, {
    method: "PUT",
    body: JSON.stringify({
      ...payload,
      replace,
      ...(device ? { device_id: device.id, device_name: device.name } : {}),
    }),
  });
}
