/**
 * Motores locais do worker: Whisper (transformers.js/ONNX) e llama.cpp
 * (wllama). Os dois rodam no proprio navegador; nenhum texto sai da maquina.
 *
 * O runtime ONNX vem do proprio pacote (assets emitidos pelo Vite), nao de CDN:
 * uma aba que carrega codigo de terceiros poderia ler o token do usuario e o
 * texto das notas. O download do Hugging Face e apenas de pesos publicos.
 */

import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import { Wllama } from "@wllama/wllama/esm/index.js";
import wllamaWasm from "@wllama/wllama/esm/wasm/wllama.wasm?url";

import type { BrowserPlan } from "../lib/browserModels";
import { browserCacheAvailable } from "../lib/browserCache";
import { llmModelUrl } from "../lib/browserModels";
import { createWllamaCacheManager, persistentModelStorageAvailable } from "./wllamaStorage";
import type { LlmGeneration, LlmMessage } from "./analysis";

export type EngineStage =
  | "loading-transcriber"
  | "downloading-transcriber"
  | "loading-llm"
  | "downloading-llm"
  | "ready";

export interface EngineProgress {
  stage: EngineStage;
  /** 0..1 quando o runtime informa; -1 quando nao ha progresso medivel. */
  progress: number;
  loadedBytes?: number;
  totalBytes?: number;
  detail?: string;
}

export interface TranscriptionSegment {
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface Transcription {
  text: string;
  language: string;
  segments: TranscriptionSegment[];
  wallMs: number;
}

interface WhisperChunk {
  text?: string;
  timestamp?: [number | null, number | null] | null;
}

interface WhisperOutput {
  text?: string;
  chunks?: WhisperChunk[];
}

interface OnnxWasmConfig {
  wasmPaths?: { wasm: string; mjs: string } | string;
  numThreads?: number;
}

/**
 * Os arquivos do ONNX Runtime sao copiados para public/ort no build. O prefixo
 * deixa o runtime pedir a variante certa (WASM comum ou jsep/WebGPU).
 */
const ONNX_WASM_PATH = "/ort/";

/** O navegador consegue rodar o Whisper na GPU? */
export function webGpuAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}


/**
 * Deixa o ONNX Runtime carregar o glue/wasm do proprio servidor. Sem isso o
 * transformers.js busca o runtime no jsDelivr, o que poria codigo de terceiros
 * dentro da aba que tem o token do usuario.
 */
function configureOnnx(): void {
  const onnx = env.backends.onnx as unknown as { wasm?: OnnxWasmConfig };
  if (!onnx.wasm) return;
  onnx.wasm.wasmPaths = ONNX_WASM_PATH;
  // O runtime trava ao criar a sessao em um Web Worker quando tenta abrir
  // varios threads (o pool disputa com a thread que espera a sessao). Uma
  // thread e mais lenta, mas carrega de verdade; o llama.cpp tem o proprio
  // pool e nao passa por aqui.
  onnx.wasm.numThreads = 1;
}

export class BrowserEngine {
  private transcriber: AutomaticSpeechRecognitionPipeline | null = null;
  private transcriberRepo = "";
  private llama: Wllama | null = null;
  private llamaId = "";
  private readonly onProgress: (progress: EngineProgress) => void;
  private gpuForWhisper = false;

  constructor(onProgress: (progress: EngineProgress) => void = () => undefined) {
    this.onProgress = onProgress;
  }

  get activeModelId(): string {
    return this.llamaId;
  }

  /** Baixa (se preciso) e carrega o Whisper do plano. */
  async loadTranscriber(plan: BrowserPlan, allowGpu = true): Promise<void> {
    if (this.transcriber && this.transcriberRepo === plan.whisper.repo) return;
    await this.unloadTranscriber();
    const useGpu = allowGpu && webGpuAvailable();
    this.gpuForWhisper = useGpu;
    configureOnnx();
    const cacheAvailable = browserCacheAvailable();
    env.allowLocalModels = false;
    env.useBrowserCache = cacheAvailable;
    env.useWasmCache = cacheAvailable;
    this.onProgress({
      stage: "loading-transcriber",
      progress: -1,
      detail: `${plan.whisper.label} · ${useGpu ? "webgpu" : "wasm"} · isolated=${globalThis.crossOriginIsolated ? "sim" : "nao"}`,
    });
    const build = (device: "webgpu" | "wasm") =>
      pipeline("automatic-speech-recognition", plan.whisper.repo, {
        revision: plan.whisper.revision,
        dtype: "q8",
        device,
        progress_callback: (report: {
          status?: string;
          file?: string;
          loaded?: number;
          total?: number;
          progress?: number;
        }) => {
          if (report.status !== "progress") return;
          this.onProgress({
            stage: "downloading-transcriber",
            progress: typeof report.progress === "number" ? report.progress / 100 : -1,
            loadedBytes: report.loaded,
            totalBytes: report.total,
            detail: report.file,
          });
        },
      }) as Promise<AutomaticSpeechRecognitionPipeline>;
    try {
      this.transcriber = await build(useGpu ? "webgpu" : "wasm");
    } catch (error) {
      if (!useGpu) throw error;
      // Adaptador WebGPU presente mas inutil (driver antigo, software): o
      // Whisper continua em WebAssembly em vez de derrubar o modo inteiro.
      this.gpuForWhisper = false;
      this.onProgress({ stage: "loading-transcriber", progress: -1, detail: "wasm" });
      this.transcriber = await build("wasm");
    }
    this.transcriberRepo = plan.whisper.repo;
    this.onProgress({ stage: "ready", progress: 1, detail: plan.whisper.label });
  }

  /** Baixa (se preciso) e carrega o GGUF de analise. */
  async loadLlm(plan: BrowserPlan, contextSize?: number, allowGpu = true, threads = 0): Promise<void> {
    if (this.llama && this.llamaId === plan.llm.id) return;
    await this.unloadLlm();
    this.onProgress({ stage: "loading-llm", progress: -1, detail: plan.llm.label });
    // O wllama guarda o modelo em OPFS. Sem contexto seguro (HTTP por IP) o
    // construtor padrao aborta: "No supported storage backend found". Nesse
    // caso o GGUF vem como blob e vive so na memoria da aba.
    const persistent = persistentModelStorageAvailable();
    const instance = new Wllama(
      { default: wllamaWasm },
      {
        // Sem CDN: o wasm vem do proprio pacote servido pelo dashboard.
        parallelDownloads: 3,
        allowOffline: persistent,
        ...(persistent ? {} : { cacheManager: createWllamaCacheManager() }),
      },
    );
    // Todos os nucleos por padrao: deixar nucleos de fora so alonga a nota numa
    // CPU antiga. O laboratorio permite "metade" para quem precisa da maquina.
    const workers = Math.max(
      1,
      Math.min(32, threads > 0 ? threads : (navigator.hardwareConcurrency || 2)),
    );
    const url = llmModelUrl(plan.llm);
    const params = {
      n_ctx: contextSize ?? plan.contextSize,
      n_batch: 256,
      n_threads: workers,
      progressCallback: (report: { loaded: number; total: number }) => {
        this.onProgress({
          stage: "downloading-llm",
          progress: report.total > 0 ? report.loaded / report.total : -1,
          loadedBytes: report.loaded,
          totalBytes: report.total,
          detail: plan.llm.label,
        });
      },
    };
    const load = (gpuLayers: number) =>
      persistent
        ? instance.loadModelFromUrl(url, { ...params, n_gpu_layers: gpuLayers, useCache: true })
        : this.loadFromMemory(instance, plan, { ...params, n_gpu_layers: gpuLayers });
    // WebGPU acelera onde o runtime suporta; se a inicializacao falhar (driver
    // antigo, Firefox sem compat), refaz na CPU em vez de derrubar a aba.
    const useGpu = allowGpu && typeof navigator !== "undefined" && "gpu" in navigator;
    try {
      await load(useGpu ? 99 : 0);
    } catch (error) {
      if (!useGpu) throw error;
      await load(0);
    }
    this.llama = instance;
    this.llamaId = plan.llm.id;
    this.onProgress({ stage: "ready", progress: 1, detail: plan.llm.label });
  }

  /**
   * Caminho sem OPFS: baixa os shards com progresso e entrega os blobs ao
   * wllama. Evita o cache manager (que precisa de IndexedDB/OPFS e de
   * `crypto.subtle`) e mantem o modo funcionando em HTTP.
   */
  private async loadFromMemory(
    instance: Wllama,
    plan: BrowserPlan,
    params: { n_ctx: number; n_batch: number; n_threads: number; n_gpu_layers: number },
  ): Promise<void> {
    const shards =
      plan.llm.shards.length > 0
        ? plan.llm.shards
        : [{ file: plan.llm.file, sizeBytes: plan.llm.sizeBytes, sha256: "" }];
    const total = shards.reduce((sum, shard) => sum + shard.sizeBytes, 0);
    const blobs: Blob[] = [];
    let done = 0;
    for (const shard of shards) {
      const url = `https://huggingface.co/${plan.llm.repo}/resolve/${plan.llm.revision}/${shard.file}`;
      const response = await fetch(url);
      if (!response.ok || !response.body) {
        throw new Error(`download do modelo falhou (HTTP ${response.status})`);
      }
      const reader = response.body.getReader();
      const parts: BlobPart[] = [];
      let loaded = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        parts.push(chunk.value);
        loaded += chunk.value.byteLength;
        this.onProgress({
          stage: "downloading-llm",
          progress: total > 0 ? (done + loaded) / total : -1,
          loadedBytes: done + loaded,
          totalBytes: total,
          detail: plan.llm.label,
        });
      }
      done += loaded;
      blobs.push(new Blob(parts, { type: "application/octet-stream" }));
    }
    await instance.loadModel(blobs, params);
  }

  /** Transcreve audio mono 16 kHz. */
  async transcribe(audio: Float32Array, language = "portuguese"): Promise<Transcription> {
    if (!this.transcriber) throw new Error("Whisper nao carregado");
    const started = Date.now();
    const output = (await this.transcriber(audio, {
      language,
      task: "transcribe",
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
    })) as WhisperOutput;
    const segments: TranscriptionSegment[] = [];
    for (const chunk of output.chunks ?? []) {
      const text = (chunk.text ?? "").trim();
      if (text === "") continue;
      const [start, end] = chunk.timestamp ?? [0, 0];
      const startMs = Math.max(0, Math.round((start ?? 0) * 1000));
      const endMs = Math.max(startMs, Math.round((end ?? start ?? 0) * 1000));
      segments.push({ start_ms: startMs, end_ms: endMs, text });
    }
    if (segments.length === 0 && (output.text ?? "").trim() !== "") {
      const seconds = audio.length / 16000;
      segments.push({ start_ms: 0, end_ms: Math.round(seconds * 1000), text: (output.text ?? "").trim() });
    }
    return {
      text: segments.map((segment) => segment.text).join(" ").trim(),
      language: this.gpuForWhisper ? `${language} (gpu)` : `${language} (cpu)`,
      segments,
      wallMs: Date.now() - started,
    };
  }

  /** Uma completion estruturada no modelo de analise. */
  async generate(input: {
    messages: LlmMessage[];
    schema: Record<string, unknown>;
    maxTokens: number;
  }): Promise<LlmGeneration> {
    if (!this.llama) throw new Error("modelo de analise nao carregado");
    const started = Date.now();
    // Alguns templates de chat do GGUF ignoram a mensagem de sistema (o
    // LFM2.5 entre eles). Sem as regras, o modelo devolve o JSON vazio do
    // exemplo. Dobrar o sistema na primeira mensagem do usuario mantem o
    // pedido inteiro em qualquer template.
    const system = input.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const conversation = input.messages.filter((message) => message.role !== "system");
    const messages =
      system === ""
        ? input.messages
        : [
            {
              role: "user" as const,
              content: `${system}\n\n${conversation.map((message) => message.content).join("\n\n")}`,
            },
          ];
    const result = await this.llama.createChatCompletion({
      messages,
      max_tokens: input.maxTokens,
      temperature: 0.1,
      top_k: 50,
      top_p: 0.95,
      penalty_repeat: 1.05,
      cache_prompt: false,
      // A gramatica garante as chaves do contrato mesmo num modelo pequeno. O
      // prompt nao traz mais um objeto de exemplo (o modelo copiava o exemplo
      // vazio), entao a forma vem daqui e o conteudo, do bloco.
      response_format: {
        type: "json_schema",
        json_schema: { name: "bloco", strict: true, schema: input.schema },
      },
      // Qwen3.5 entra em modo de raciocinio por padrao; sem desligar, os tokens
      // acabam antes de o JSON comecar e o conteudo volta vazio.
      chat_template_kwargs: {
        enable_thinking: false,
        // A LFM2.5 preserva o bloco de raciocinio no prompt; isso gasta o teto
        // de tokens antes do JSON e devolve conteudo vazio.
        preserve_thinking: false,
      },
    });
    const text = (result.choices?.[0]?.message?.content ?? "").trim();
    return {
      text,
      promptTokens: result.usage?.prompt_tokens ?? 0,
      completionTokens: result.usage?.completion_tokens ?? 0,
      wallMs: Date.now() - started,
    };
  }

  async unloadTranscriber(): Promise<void> {
    const current = this.transcriber;
    this.transcriber = null;
    this.transcriberRepo = "";
    if (current) {
      try {
        await current.dispose();
      } catch {
        // runtime ja descarregado
      }
    }
  }

  async unloadLlm(): Promise<void> {
    const current = this.llama;
    this.llama = null;
    this.llamaId = "";
    if (current) {
      try {
        await current.exit();
      } catch {
        // runtime ja encerrado
      }
    }
  }

  async dispose(): Promise<void> {
    await this.unloadTranscriber();
    await this.unloadLlm();
  }
}
