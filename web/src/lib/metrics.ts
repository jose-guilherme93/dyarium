/**
 * Analise do dashboard.
 *
 * O snapshot schema 2 e sempre calculado neste cliente, a partir das notas que
 * ele ja tem: no cofre do navegador (sem token) ou nas entradas com texto do
 * servidor (com token). Nada de desenhar um documento pronto enviado pelo
 * aparelho — os dois clientes calculam a propria analise.
 *
 * A conta em si vive no nucleo puro do app (`metricsSnapshot`), o mesmo que o
 * app usa. Aqui so entram o envelope do navegador (`device_id`/`device_name`) e
 * a traducao da entrada do servidor para o formato `Recording`.
 */

import { buildMetricsSnapshot, METRICS_SCHEMA } from "../../../mobile/src/core/metricsSnapshot";
import type { Recording } from "../../../mobile/src/core/types";
import type { Entry, MetricsSnapshotV2 } from "../types";

/**
 * Entrada da lista com os campos de `include_text=1`. Ficam aqui, e nao no
 * `Entry` geral, porque so a analise do dashboard pede o texto completo.
 */
export type EntryWithText = Entry & { text?: string; transcript?: string };

/** Chave do identificador estavel deste navegador. */
const DEVICE_KEY = "dyarium.web.device";

/** Nome que o dashboard mostra no lugar do aparelho. */
export const WEB_DEVICE_NAME = "Navegador";

/** Reserva quando o navegador bloqueia o localStorage (privacidade/iframe). */
let memoryDeviceId = "";

function newDeviceId(): string {
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `web-${uuid}`;
}

/**
 * Identificador estavel do navegador. Fica no localStorage para o mesmo
 * navegador continuar sendo o mesmo "dispositivo" entre sessoes; sem storage,
 * vale so para esta carga da pagina.
 */
export function webDeviceId(): string {
  try {
    const stored = localStorage.getItem(DEVICE_KEY);
    if (stored) return stored;
    const id = newDeviceId();
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    if (!memoryDeviceId) memoryDeviceId = newDeviceId();
    return memoryDeviceId;
  }
}

/**
 * Snapshot pronto para a tela. `now` entra por parametro para o teste fixar o
 * relogio; a conta continua deterministica para a mesma entrada e o mesmo now.
 */
export function buildWebSnapshot(
  recordings: Recording[],
  options: { deviceId: string; now?: Date },
): MetricsSnapshotV2 {
  const now = options.now ?? new Date();
  const snapshot = buildMetricsSnapshot(recordings, now);

  return {
    schema: METRICS_SCHEMA,
    generated_at: snapshot.generated_at,
    streak: snapshot.streak,
    windows: snapshot.windows,
    history: snapshot.history,
    device_id: options.deviceId,
    device_name: WEB_DEVICE_NAME,
    received_at: now.toISOString(),
  };
}

/**
 * A entrada do servidor no formato que o nucleo le. `include_text=1` traz o
 * corpo completo (`text`) e a transcricao (`transcript`); a duracao vem em
 * segundos e aqui vira milissegundos, como no app.
 */
export function recordingFromEntry(entry: EntryWithText): Recording {
  const seconds = entry.duration_seconds ?? 0;
  const transcript = entry.transcript?.trim() ? entry.transcript : undefined;

  return {
    id: entry.id,
    title: entry.title ?? "",
    recordedAt: entry.recorded_at ?? entry.created_at,
    dir: "",
    segmentCount: seconds > 0 ? 1 : 0,
    status: "completed",
    offset: 0,
    attempts: 0,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
    text: entry.text,
    transcript,
    hasTranscript: Boolean(transcript),
    transcriptOrigin: transcript ? "server" : undefined,
    durationMs: seconds > 0 ? Math.round(seconds * 1000) : undefined,
    notebookId: entry.notebook_id,
    tags: entry.tags,
    source: entry.source === "text" ? "text" : "microphone",
    contentType: entry.content_type || undefined,
    entryId: entry.id,
  };
}
