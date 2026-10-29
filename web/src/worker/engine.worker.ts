/// <reference lib="webworker" />
/**
 * Worker de inferencia do dashboard.
 *
 * A decodificacao do audio fica na thread principal (o AudioContext nao existe
 * aqui); este worker recebe o PCM 16 kHz pronto. Whisper e llama.cpp rodam aqui
 * para a interface continuar respondendo enquanto a nota e processada.
 */

import type { BrowserPlan } from "../lib/browserModels";
import type { AnalysisProgress, WorkerNote } from "./analysis";
import { analyzeNoteInBrowser } from "./analysis";
import { BrowserEngine, type EngineProgress, type Transcription } from "./engine";

interface LoadRequest {
  id: number;
  type: "load";
  plan: BrowserPlan;
  allowGpu: boolean;
  contextSize?: number;
  /** Nucleos para o llama.cpp; 0 usa todos os que o navegador informa. */
  threads?: number;
}

interface PrepareRequest {
  id: number;
  type: "prepare";
  plan: BrowserPlan;
  allowGpu: boolean;
  contextSize?: number;
  threads?: number;
}

interface TranscribeRequest {
  id: number;
  type: "transcribe";
  audio: Float32Array;
  language?: string;
}

interface AnalyzeRequest {
  id: number;
  type: "analyze";
  note: WorkerNote;
  modelId: string;
}

interface StopRequest {
  id: number;
  type: "stop";
}

interface DisposeRequest {
  id: number;
  type: "dispose";
}

type WorkerRequest =
  | LoadRequest
  | PrepareRequest
  | TranscribeRequest
  | AnalyzeRequest
  | StopRequest
  | DisposeRequest;

type WorkerResponse =
  | { id: number; type: "engine-progress"; progress: EngineProgress }
  | { id: number; type: "analysis-progress"; progress: AnalysisProgress }
  | { id: number; type: "result"; result: unknown }
  | { id: number; type: "error"; message: string };

const scope = self as DedicatedWorkerGlobalScope;

let engine: BrowserEngine | null = null;
let stopped = false;

function post(message: WorkerResponse): void {
  scope.postMessage(message);
}

function ensureEngine(): BrowserEngine {
  if (!engine) {
    engine = new BrowserEngine((progress) => {
      post({ id: 0, type: "engine-progress", progress });
    });
  }
  return engine;
}

async function handle(request: WorkerRequest): Promise<void> {
  if (request.type === "stop") {
    stopped = true;
    return;
  }
  if (request.type === "dispose") {
    await engine?.dispose();
    engine = null;
    post({ id: request.id, type: "result", result: null });
    return;
  }
  const browser = ensureEngine();
  switch (request.type) {
    case "load":
    case "prepare": {
      await browser.loadTranscriber(request.plan, request.allowGpu);
      await browser.loadLlm(request.plan, request.contextSize, request.allowGpu, request.threads);
      post({ id: request.id, type: "result", result: { ready: true } });
      return;
    }
    case "transcribe": {
      const transcription: Transcription = await browser.transcribe(
        request.audio,
        request.language ?? "portuguese",
      );
      post({ id: request.id, type: "result", result: transcription });
      return;
    }
    case "analyze": {
      stopped = false;
      const result = await analyzeNoteInBrowser(
        request.note,
        request.modelId,
        (input) => browser.generate(input),
        {
          shouldStop: () => stopped,
          onProgress: (progress) => post({ id: request.id, type: "analysis-progress", progress }),
        },
      );
      post({ id: request.id, type: "result", result });
      return;
    }
    default:
      post({ id: (request as { id: number }).id, type: "error", message: "pedido desconhecido" });
  }
}

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  void handle(request).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "falha no processamento local";
    post({ id: request.id, type: "error", message });
  });
};
