/**
 * Transcricao de uma nota de audio no proprio navegador.
 *
 * A nota pode existir so no cofre local (IndexedDB): o audio e lido do anexo,
 * decodificado na thread principal e entregue ao worker de inferencia, que roda
 * o Whisper. Nenhum byte sobe para o servidor.
 *
 * A armadilha aqui e o download: ligar o worker pelo caminho normal baixa
 * Whisper e GGUF. Para transcrever basta o Whisper, entao o plano e enviado com
 * `configure` (sem `warm`) e so o transcritor entra na memoria.
 */

import { getRecording, upsertRecording } from "../../../mobile/src/core/repo";
import type { TranscriptSegment } from "../../../mobile/src/core/types";

import type { BrowserPlan } from "../lib/browserModels";
import { EngineClient } from "../lib/engineClient";
import { decodeAudio, toMono16k } from "../lib/audioDecode";
import {
  allowGpuFor,
  detectHardwareOnce,
  effectiveThreads,
  readBackend,
  readThreadMode,
  resolveWorkerPlan,
} from "../lib/workerSetup";
import type { Transcription } from "../worker/engine";

import type { Segment, Transcript } from "../types";

import { audioBlobOf } from "./audio";

export interface LocalTranscribeProgress {
  stage: "preparing" | "decoding" | "transcribing" | "saving" | "done";
  /** 0..1 quando o motor souber; ausente quando nao ha fracao. */
  fraction?: number;
}

/** O motor de inferencia que a transcricao usa; so o que ela precisa. */
export interface LocalTranscribeEngine {
  configure(plan: BrowserPlan, allowGpu: boolean, threads?: number): void;
  transcribe(audio: Float32Array, language?: string): Promise<Transcription>;
  dispose?(): void;
}

export interface LocalTranscribePlan {
  plan: BrowserPlan;
  allowGpu: boolean;
  threads: number;
}

export interface LocalTranscribeOptions {
  language?: string;
  signal?: AbortSignal;
  onProgress?: (progress: LocalTranscribeProgress) => void;
  /** Injetavel nos testes; por padrao cria um EngineClient. */
  engineFactory?: () => LocalTranscribeEngine;
  /** Injetavel nos testes; por padrao detectHardwareOnce + resolveWorkerPlan. */
  planFactory?: () => Promise<LocalTranscribePlan>;
}

/**
 * Perfil que o botao da nota usa. O mesmo caminho do laboratorio: escolha salva
 * vence a recomendacao, e a GPU so entra quando o navegador a entrega.
 */
async function defaultPlan(): Promise<LocalTranscribePlan> {
  const snapshot = await detectHardwareOnce();
  const { plan } = resolveWorkerPlan(snapshot);
  return {
    plan,
    allowGpu: allowGpuFor(snapshot, readBackend()),
    // Sem contexto isolado o motor cai para uma thread; o numero reflete isso.
    threads: effectiveThreads(readThreadMode(), snapshot.cpu.threads),
  };
}

function abortError(): DOMException {
  return new DOMException("aborted", "AbortError");
}

/** Cancela entre etapas: a transcricao nao segue para o proximo passo. */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

/** Trecho no formato do cofre (`transcriptSegments` do nucleo). */
function toStoredSegment(segment: Segment): TranscriptSegment {
  return {
    start_ms: segment.start_ms,
    end_ms: segment.end_ms,
    text: segment.text,
  };
}

/**
 * Transcreve o audio da nota com o Whisper do navegador e grava o resultado no
 * cofre local. Devolve o `Transcript` no formato que a web ja desenha.
 */
export async function transcribeEntryLocally(
  entryId: string,
  options: LocalTranscribeOptions = {},
): Promise<Transcript> {
  const { language = "portuguese", signal, onProgress } = options;

  const blob = await audioBlobOf(entryId);
  if (!blob) throw new Error("esta nota nao tem audio");
  throwIfAborted(signal);

  onProgress?.({ stage: "preparing" });
  const resolvePlan = options.planFactory ?? defaultPlan;
  const { plan, allowGpu, threads } = await resolvePlan();
  throwIfAborted(signal);

  // Criar o cliente aqui e o unico caminho que ele tem: se fomos nos, o worker
  // e encerrado no fim para nao guardar o Whisper carregado na aba.
  const ownEngine = options.engineFactory === undefined;
  const engine = (options.engineFactory ?? (() => new EngineClient()))();
  try {
    // Sem `warm`: so o Whisper precisa entrar, o GGUF da analise nao.
    engine.configure(plan, allowGpu, threads);
    throwIfAborted(signal);

    onProgress?.({ stage: "decoding" });
    const decoded = await decodeAudio(await blob.arrayBuffer());
    const pcm = await toMono16k(decoded);
    throwIfAborted(signal);

    onProgress?.({ stage: "transcribing" });
    const transcription = await engine.transcribe(pcm, language);
    throwIfAborted(signal);

    const segments: Segment[] = transcription.segments.map((segment, idx) => ({
      idx,
      start_ms: segment.start_ms,
      end_ms: segment.end_ms,
      text: segment.text,
    }));
    const text = transcription.text;
    const transcript: Transcript = {
      model: plan.whisper.id,
      language,
      text,
      raw_text: text,
      trim_silence: false,
      // O tempo real vem do audio decodificado, nao da estimativa do modelo.
      duration_seconds: Math.round(decoded.duration),
      segments,
    };

    onProgress?.({ stage: "saving" });
    const recording = await getRecording(entryId);
    if (!recording) throw new Error("nota local nao encontrada");
    // O ultimo ponto de cancelamento: depois daqui o cofre ja seria alterado.
    throwIfAborted(signal);
    await upsertRecording({
      ...recording,
      transcript: text,
      transcriptSegments: segments.map(toStoredSegment),
      transcriptStatus: "ready",
      transcriptOrigin: "local",
      hasTranscript: true,
      transcriptLanguage: language,
      updatedAt: new Date().toISOString(),
    });

    onProgress?.({ stage: "done" });
    return transcript;
  } finally {
    if (ownEngine) engine.dispose?.();
  }
}

/** Transcricao ja gravada na nota, no formato que a web desenha. */
export async function transcriptOf(entryId: string): Promise<Transcript | null> {
  const recording = await getRecording(entryId);
  if (!recording || !recording.transcript) return null;
  const segments: Segment[] = (recording.transcriptSegments ?? []).map((segment, idx) => ({
    idx,
    start_ms: segment.start_ms,
    end_ms: segment.end_ms,
    text: segment.text,
    ...(segment.revised ? { revised: segment.revised } : {}),
    ...(segment.edited ? { edited: true } : {}),
  }));
  return {
    model: recording.transcriptOrigin === "local" ? "local" : "",
    language: recording.transcriptLanguage ?? "",
    text: recording.transcript,
    raw_text: recording.transcript,
    trim_silence: false,
    duration_seconds: Math.round((recording.durationMs ?? 0) / 1000),
    segments,
    ...(recording.transcriptReview ? { revised: true } : {}),
  };
}

/** Segmentos da transcricao, na ordem em que foram falados. */
export async function segmentsOf(entryId: string): Promise<Segment[]> {
  const transcript = await transcriptOf(entryId);
  return transcript?.segments ?? [];
}
