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

import type { BrowserPlan, WhisperModel } from "../lib/browserModels";
import { browserCacheAvailable, modelCacheAvailable } from "../lib/browserCache";
import { cpuWhisper, llmModelUrl } from "../lib/browserModels";
import { modelStoreGet, modelStoreSet } from "../lib/modelStore";
import { createIndexedDbHttpCache } from "./modelCache";
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
  /** Threads que o motor abriu de fato (o ONNX fica em uma). */
  threads?: number;
  /** Onde a etapa roda de verdade: GPU, CPU (llama.cpp) ou WebAssembly. */
  backend?: "webgpu" | "cpu" | "wasm";
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
  private plan: BrowserPlan | null = null;
  private allowGpu = true;
  private threads = 0;
  private contextSize: number | undefined;

  constructor(onProgress: (progress: EngineProgress) => void = () => undefined) {
    this.onProgress = onProgress;
  }

  get activeModelId(): string {
    return this.llamaId;
  }

  /**
   * Guarda o plano sem baixar nada. Cada tipo de nota carrega so o motor de
   * que precisa: uma analise de texto nao paga o download do Whisper e uma
   * transcricao nao paga o download do GGUF.
   */
  configure(plan: BrowserPlan, allowGpu = true, threads = 0, contextSize?: number): void {
    this.plan = plan;
    this.allowGpu = allowGpu;
    this.threads = threads;
    this.contextSize = contextSize ?? plan.contextSize;
  }

  async ensureTranscriber(): Promise<void> {
    if (this.transcriber) return;
    if (!this.plan) throw new Error("processamento local nao configurado");
    await this.loadTranscriber(this.plan, this.allowGpu);
  }

  async ensureLlm(): Promise<void> {
    if (!this.plan) throw new Error("processamento local nao configurado");
    // Um GGUF diferente do plano nao pode ser reaproveitado: o usuario trocou de
    // perfil e a analise nao pode sair com o modelo anterior.
    if (this.llama && this.llamaId === this.plan.llm.id) return;
    await this.loadLlm(this.plan, this.contextSize, this.allowGpu, this.threads);
  }

  /**
   * Baixa os dois modelos agora, um de cada vez.
   *
   * Ativar o modo local deixa a maquina pronta: o download nao espera a
   * primeira nota de cada tipo. A memoria continua com um motor so; o Whisper
   * sai antes de o GGUF entrar e volta do cache quando houver transcricao.
   */
  async warm(): Promise<void> {
    await this.ensureTranscriber();
    await this.ensureLlm();
  }

  /** Baixa (se preciso) e carrega o Whisper do plano. */
  async loadTranscriber(plan: BrowserPlan, allowGpu = true): Promise<void> {
    if (this.transcriber && this.transcriberRepo === plan.whisper.repo) return;
    // Um motor por vez: o GGUF sai da memoria antes de o ONNX entrar e o
    // contrario tambem vale. Sem isso, os dois modelos disputam a RAM da aba.
    if (this.llama) await this.unloadLlm();
    await this.unloadTranscriber();
    const useGpu = allowGpu && webGpuAvailable();
    this.gpuForWhisper = useGpu;
    configureOnnx();
    // Cache API so existe em contexto seguro; o IndexedDB cobre HTTP por IP.
    const customCache = modelCacheAvailable() ? createIndexedDbHttpCache() : null;
    env.allowLocalModels = false;
    env.useBrowserCache = browserCacheAvailable();
    env.useCustomCache = customCache !== null;
    env.customCache = customCache;
    env.useWasmCache = customCache !== null || browserCacheAvailable();
    this.onProgress({
      stage: "loading-transcriber",
      progress: -1,
      detail: `${plan.whisper.label} · ${useGpu ? "webgpu" : "wasm"} · isolated=${globalThis.crossOriginIsolated ? "sim" : "nao"}`,
      // O pool de threads do ONNX trava dentro de um Web Worker; o transcritor
      // fica em uma thread de proposito. A GPU e o caminho rapido dele.
      threads: 1,
      backend: useGpu ? "webgpu" : "wasm",
    });
    const build = (device: "webgpu" | "wasm", model: WhisperModel = plan.whisper) =>
      pipeline("automatic-speech-recognition", model.repo, {
        revision: model.revision,
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
    let loadedModel = plan.whisper;
    try {
      this.transcriber = await build(useGpu ? "webgpu" : "wasm");
    } catch (error) {
      if (!useGpu) throw error;
      // Adaptador WebGPU presente mas inutil (driver antigo, software): o
      // Whisper continua em WebAssembly em vez de derrubar o modo inteiro.
      // O large-v3-turbo nunca entra nesse caminho: em uma thread ele levaria
      // horas, entao a CPU usa o small.
      this.gpuForWhisper = false;
      loadedModel = cpuWhisper(plan.whisper);
      this.onProgress({
        stage: "loading-transcriber",
        progress: -1,
        detail: `${loadedModel.label} · wasm`,
        threads: 1,
        backend: "wasm",
      });
      this.transcriber = await build("wasm", loadedModel);
    }
    this.transcriberRepo = loadedModel.repo;
    this.onProgress({
      stage: "ready",
      progress: 1,
      detail: loadedModel.label,
      threads: 1,
      backend: this.gpuForWhisper ? "webgpu" : "wasm",
    });
  }

  /** Baixa (se preciso) e carrega o GGUF de analise. */
  async loadLlm(plan: BrowserPlan, contextSize?: number, allowGpu = true, threads = 0): Promise<void> {
    if (this.llama && this.llamaId === plan.llm.id) return;
    // O Whisper fica na memoria enquanto ele existe; soltar antes de abrir o
    // GGUF evita manter 1 GB parado durante a leitura dos blocos.
    if (this.transcriber) await this.unloadTranscriber();
    await this.unloadLlm();
    this.onProgress({ stage: "loading-llm", progress: -1, detail: plan.llm.label });
    // O wllama guarda o modelo em OPFS. Sem contexto seguro (HTTP por IP) o
    // construtor padrao aborta: "No supported storage backend found". Nesse
    // caso o GGUF vem como blob e vive so na memoria da aba.
    const persistent = persistentModelStorageAvailable();
    const createInstance = () =>
      new Wllama(
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
    // Uma instancia por tentativa: depois de `wllamaStart`, o proxy do wllama
    // ja existe e uma segunda carga no mesmo objeto falha com "Module is already
    // initialized" — era o que impedia o fallback de GPU para CPU de funcionar.
    const load = async (gpuLayers: number): Promise<Wllama> => {
      const instance = createInstance();
      try {
        if (persistent) {
          await instance.loadModelFromUrl(url, {
            ...params,
            n_gpu_layers: gpuLayers,
            useCache: true,
          });
        } else {
          await this.loadFromMemory(instance, plan, { ...params, n_gpu_layers: gpuLayers });
        }
        return instance;
      } catch (error) {
        await instance.exit().catch(() => undefined);
        throw error;
      }
    };
    // WebGPU acelera onde o runtime suporta; se a inicializacao falhar (driver
    // antigo, Firefox sem compat), refaz na CPU em vez de derrubar a aba.
    const useGpu = allowGpu && typeof navigator !== "undefined" && "gpu" in navigator;
    let instance: Wllama;
    let gpuLayers = 0;
    try {
      instance = await load(useGpu ? 99 : 0);
      gpuLayers = useGpu ? 99 : 0;
    } catch (error) {
      if (!useGpu) throw error;
      instance = await load(0);
    }
    this.llama = instance;
    this.llamaId = plan.llm.id;
    // O numero que a UI mostra e o que o llama.cpp abriu, nao o que o
    // navegador prometeu. Com offload de GPU, os threads de CPU continuam
    // existindo para as operacoes de apoio.
    this.onProgress({
      stage: "ready",
      progress: 1,
      detail: plan.llm.label,
      threads: instance.getNumThreads(),
      backend: gpuLayers > 0 ? "webgpu" : "cpu",
    });
  }

  /**
   * Caminho sem OPFS: baixa os shards com progresso e entrega os blobs ao
   * wllama. Os shards ficam no IndexedDB, que funciona em HTTP por IP; sem
   * isso o download recomecava a cada recarga.
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
      const cacheKey = `gguf|${plan.llm.id}|${plan.llm.revision}|${shard.file}`;
      const cached = await modelStoreGet<Blob>(cacheKey);
      if (cached && cached.size > 0) {
        blobs.push(cached);
        done += cached.size;
        this.onProgress({
          stage: "downloading-llm",
          progress: total > 0 ? done / total : 1,
          loadedBytes: done,
          totalBytes: total,
          detail: `${plan.llm.label} · cache`,
        });
        continue;
      }
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
      const blob = new Blob(parts, { type: "application/octet-stream" });
      await modelStoreSet(cacheKey, blob);
      done += loaded;
      blobs.push(blob);
    }
    await instance.loadModel(blobs, params);
  }

  /** Transcreve audio mono 16 kHz; sem idioma, o modelo detecta. */
  async transcribe(audio: Float32Array, language?: string): Promise<Transcription> {
    if (!this.transcriber) throw new Error("Whisper nao carregado");
    const started = Date.now();
    const output = (await this.transcriber(audio, {
      ...(language ? { language } : {}),
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
      language: `${(output as { language?: string }).language ?? language ?? "auto"}${this.gpuForWhisper ? " (gpu)" : " (cpu)"}`,
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
      // O comeco do prompt (regras do contrato) e o mesmo em todo bloco. Com o
      // cache ligado o llama.cpp reaproveita esses tokens em vez de reprocessar
      // o preambulo inteiro a cada chamada.
      cache_prompt: true,
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
