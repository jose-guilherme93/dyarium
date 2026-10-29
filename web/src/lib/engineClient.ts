/**
 * Cliente do worker de inferencia. A interface conversa com ele; o worker faz o
 * trabalho pesado e continua vivo enquanto a aba estiver aberta.
 */

import type { BrowserPlan } from "./browserModels";
import type { AnalysisProgress, WorkerNote, WorkerAnalysis } from "../worker/analysis";
import type { EngineProgress, Transcription } from "../worker/engine";

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface EngineCallbacks {
  onEngineProgress?: (progress: EngineProgress) => void;
  onAnalysisProgress?: (progress: AnalysisProgress) => void;
}

export class EngineClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private callbacks: EngineCallbacks;

  constructor(callbacks: EngineCallbacks = {}) {
    this.callbacks = callbacks;
  }

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("../worker/engine.worker.ts", import.meta.url), {
      type: "module",
      name: "dyarium-engine",
    });
    worker.onmessage = (event: MessageEvent<{ id: number; type: string; [key: string]: unknown }>) => {
      const message = event.data;
      if (message.type === "engine-progress") {
        this.callbacks.onEngineProgress?.(message.progress as EngineProgress);
        return;
      }
      if (message.type === "analysis-progress") {
        this.callbacks.onAnalysisProgress?.(message.progress as AnalysisProgress);
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.type === "error") {
        pending.reject(new Error(String(message.message ?? "falha no processamento local")));
        return;
      }
      pending.resolve(message.result);
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || "o worker local falhou");
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      this.worker = null;
    };
    this.worker = worker;
    return worker;
  }

  private send<T>(request: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
    const worker = this.ensure();
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      worker.postMessage({ ...request, id }, transfer);
    });
  }

  /** Baixa, se preciso, e carrega os dois modelos. */
  load(plan: BrowserPlan, allowGpu: boolean, threads = 0): Promise<{ ready: boolean }> {
    return this.send({ type: "load", plan, allowGpu, threads, contextSize: plan.contextSize });
  }

  transcribe(audio: Float32Array, language = "portuguese"): Promise<Transcription> {
    const copy = audio.slice();
    return this.send({ type: "transcribe", audio: copy, language }, [copy.buffer]);
  }

  analyze(note: WorkerNote, modelId: string): Promise<WorkerAnalysis> {
    return this.send({ type: "analyze", note, modelId });
  }

  stop(): void {
    this.worker?.postMessage({ type: "stop", id: ++this.seq });
  }

  dispose(): void {
    if (!this.worker) return;
    this.worker.postMessage({ type: "dispose", id: ++this.seq });
    this.worker.terminate();
    this.worker = null;
    for (const pending of this.pending.values()) {
      pending.reject(new Error("worker encerrado"));
    }
    this.pending.clear();
  }
}
