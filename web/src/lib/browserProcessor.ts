/**
 * Loop do processamento opcional no navegador.
 *
 * Enquanto esta ativo, a aba reserva jobs de transcricao e analise da fila,
 * processa com os modelos locais e devolve o resultado pela API existente. O
 * servidor nao roda modelo para esses jobs e volta a processar sozinho quando a
 * aba fecha ou o modo e desligado.
 */

import { ApiError, getToken } from "../api";
import { authorLabel } from "../../../mobile/src/core/author";
import type { Settings } from "../types";
import {
  planDownloadBytes,
  type BrowserPlan,
} from "./browserModels";
import { EngineClient } from "./engineClient";
import type { DeviceIdentity } from "./deviceIdentity";
import type { AnalysisProgress, BlockDebug } from "../worker/analysis";
import type { EngineProgress, Transcription } from "../worker/engine";
import {
  fetchAudio,
  fetchEntryBundle,
  saveAnalysis,
  saveTranscript,
  workerApi,
  type WorkerJob,
  type WorkerStatus,
} from "./workerApi";

export type ProcessorPhase = "idle" | "preparing" | "waiting" | "working" | "stopping" | "error";

export interface ProcessorJob {
  id: string;
  type: "transcribe" | "analyze";
  entryId: string;
  title: string;
  stage: string;
  read: number;
  total: number;
  blockIndex: number;
  tokensPerSecond: number;
  /** Inicio desta nota; o painel mostra o tempo decorrido. */
  startedAt: number;
}

export interface ProcessorState {
  phase: ProcessorPhase;
  plan: BrowserPlan | null;
  engine: EngineProgress | null;
  job: ProcessorJob | null;
  processed: number;
  failed: number;
  lastError: string;
  queue: WorkerStatus | null;
  downloadBytes: number;
  startedAt: string | null;
  /** Amostras locais dos blocos que vieram vazios; nunca sobem ao servidor. */
  debug: BlockDebug[];
}

const HEARTBEAT_MS = 20_000;
const POLL_MS = 3_000;
const STATUS_MS = 8_000;
const MAX_CONSECUTIVE_FAILURES = 3;
/** Tentativas de reserva de um pedido antes de soltar a preferencia. */
const EMPTY_CLAIMS = 5;
const WORKER_ID_KEY = "dyarium.browser-worker";

interface StoredSettings {
  owner_name: string;
  all_notes_mine: boolean;
}

/**
 * `crypto.randomUUID` so existe em contexto seguro (HTTPS ou localhost). O dev
 * server costuma ser aberto pelo IP da rede em HTTP, onde ele nao existe; o
 * identificador nao e segredo, entao caimos para bytes aleatorios.
 */
function randomToken(): string {
  const source = globalThis.crypto;
  if (source && typeof source.randomUUID === "function") {
    return source.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (source && typeof source.getRandomValues === "function") {
    source.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function workerId(): string {
  try {
    const existing = sessionStorage.getItem(WORKER_ID_KEY);
    if (existing) return existing;
    const created = `tab-${randomToken()}`;
    sessionStorage.setItem(WORKER_ID_KEY, created);
    return created;
  } catch {
    return `tab-${randomToken()}`;
  }
}

async function decodeAudio(data: ArrayBuffer): Promise<AudioBuffer> {
  const context = new AudioContext();
  try {
    return await context.decodeAudioData(data.slice(0));
  } finally {
    await context.close();
  }
}

/** Audio decodificado para mono 16 kHz, o formato que o Whisper espera. */
async function toMono16k(buffer: AudioBuffer): Promise<Float32Array> {
  const seconds = buffer.duration * 16000;
  const length = Math.max(1, Math.ceil(seconds));
  const offline = new OfflineAudioContext(1, length, 16000);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}

function genericFailure(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message.slice(0, 200);
  return "falha no processamento local";
}

export class BrowserProcessor {
  private state: ProcessorState = {
    phase: "idle",
    plan: null,
    engine: null,
    job: null,
    processed: 0,
    failed: 0,
    lastError: "",
    queue: null,
    downloadBytes: 0,
    startedAt: null,
    debug: [],
  };
  private readonly onChange: (state: ProcessorState) => void;
  private readonly settings: StoredSettings;
  private engine: EngineClient | null = null;
  private allowGpu = true;
  private threads = 0;
  private device: DeviceIdentity | null = null;
  private worker = workerId();
  private tier = 0;
  private models: string[] = [];
  private caps: unknown = null;
  /** Notas que o usuario mandou processar neste PC, na ordem dos cliques. */
  private pendingEntries: string[] = [];
  /** O servidor so pausa a fila enquanto ha um pedido local em andamento. */
  private preferred = false;
  /** Serializa os registros de preferencia para eles nao chegarem fora de ordem. */
  private preferenceChain: Promise<void> = Promise.resolve();
  /** Quantas reservas vazias seguidas antes de desistir de um pedido. */
  private emptyClaims = 0;
  private wake: (() => void) | null = null;
  /** Nota cujo resultado deve substituir a analise existente. */
  private replacementEntryId = "";
  private running = false;
  private lostJob = false;
  private currentJobId = "";
  private heartbeat: number | null = null;
  private statusTimer: number | null = null;
  private lastEngineReport = 0;

  constructor(
    settings: StoredSettings,
    onChange: (state: ProcessorState) => void,
  ) {
    this.settings = settings;
    this.onChange = onChange;
  }

  get snapshot(): ProcessorState {
    return this.state;
  }

  /**
   * Pede que a proxima reserva seja desta nota. Chamado pelo botao Analisar:
   * sem um pedido explicito o worker fica parado, mesmo ligado.
   */
  async beginEntry(entryId: string): Promise<boolean> {
    if (!this.running || this.state.phase === "preparing" || this.state.phase === "stopping") {
      return false;
    }
    if (!this.pendingEntries.includes(entryId)) {
      this.pendingEntries.push(entryId);
    }
    await this.setPreference(true);
    this.wakeUp();
    return true;
  }

  /** O pedido nao chegou a virar job (a API recusou): devolve a fila ao servidor. */
  async cancelEntry(entryId: string): Promise<void> {
    this.pendingEntries = this.pendingEntries.filter((id) => id !== entryId);
    await this.applyPreference();
    this.wakeUp();
  }

  /** O proximo resultado desta nota substitui a analise anterior. */
  forceReplace(entryId: string): void {
    this.replacementEntryId = entryId;
  }

  /**
   * A presenca "preferida" e o que faz o servidor largar transcribe/analyze.
   * Fica ligada so enquanto existe pedido local: parada, a VPS segue a fila.
   */
  private async applyPreference(): Promise<void> {
    await this.setPreference(this.pendingEntries.length > 0);
  }

  private async setPreference(prefer: boolean): Promise<void> {
    // Registros de preferencia sao serializados: um "desligar" atrasado nao
    // pode chegar depois de um "ligar" e pausar o servidor sem pedido.
    this.preferenceChain = this.preferenceChain.then(async () => {
      if (this.preferred === prefer || !this.running) return;
      this.preferred = prefer;
      try {
        await workerApi.register({
          workerId: this.worker,
          tier: this.tier,
          preferClient: prefer,
          models: this.models,
          caps: this.caps,
        });
      } catch {
        // O heartbeat renova a presenca; a proxima reserva confirma o estado.
      }
    });
    await this.preferenceChain;
  }

  private dropEntry(entryId: string): void {
    this.pendingEntries = this.pendingEntries.filter((id) => id !== entryId);
  }

  private wakeUp(): void {
    this.wake?.();
  }

  /** Dorme ate o tempo acabar ou ate um pedido novo acordar o loop. */
  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => {
      let timer = 0;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (this.wake === finish) this.wake = null;
        resolve();
      };
      timer = window.setTimeout(finish, ms);
      this.wake = finish;
    });
  }

  private update(patch: Partial<ProcessorState>): void {
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }

  private updateJob(patch: Partial<ProcessorJob>): void {
    if (!this.state.job) return;
    this.update({ job: { ...this.state.job, ...patch } });
  }

  private onEngineProgress(progress: EngineProgress): void {
    const now = Date.now();
    if (progress.stage !== "ready" && now - this.lastEngineReport < 120) return;
    this.lastEngineReport = now;
    this.update({ engine: progress });
  }

  private onAnalysisProgress(progress: AnalysisProgress): void {
    this.updateJob({
      stage: progress.stage,
      read: progress.read,
      total: progress.total,
      blockIndex: progress.blockIndex,
      tokensPerSecond: progress.tokensPerSecond,
    });
  }

  async start(
    plan: BrowserPlan,
    caps: unknown,
    options: { allowGpu?: boolean; threads?: number; device?: DeviceIdentity } = {},
  ): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.threads = Math.max(0, options.threads ?? 0);
    this.device = options.device ?? null;
    // GPU de software (SwiftShader/llvmpipe) e mais lenta que a CPU e pode
    // travar o carregamento do ONNX; nesse caso o worker fica no WebAssembly.
    this.allowGpu = options.allowGpu !== false;
    this.lostJob = false;
    this.tier = plan.tier;
    this.models = [plan.whisper.repo, plan.llm.id];
    this.caps = caps;
    this.pendingEntries = [];
    this.preferred = false;
    this.emptyClaims = 0;
    this.update({
      phase: "preparing",
      plan,
      job: null,
      lastError: "",
      downloadBytes: planDownloadBytes(plan),
      startedAt: new Date().toISOString(),
    });
    try {
      // Registra sem preferencia primeiro: enquanto os modelos baixam, a VPS
      // continua transcrevendo e analisando como hoje.
      await workerApi.register({
        workerId: this.worker,
        tier: plan.tier,
        preferClient: false,
        models: [plan.whisper.repo, plan.llm.id],
        caps,
      });
    } catch (error) {
      this.running = false;
      this.update({ phase: "error", lastError: genericFailure(error) });
      return;
    }

    this.engine = new EngineClient({
      onEngineProgress: (progress) => this.onEngineProgress(progress),
      onAnalysisProgress: (progress) => this.onAnalysisProgress(progress),
    });

    try {
      await this.engine.load(plan, this.allowGpu, this.threads);
    } catch (error) {
      // Parar durante o download encerra o worker de proposito; isso nao e uma
      // falha para mostrar ao usuario.
      const stopped = !this.running || this.state.phase === "stopping";
      this.running = false;
      await workerApi.unregister(this.worker).catch(() => undefined);
      this.engine?.dispose();
      this.engine = null;
      this.update(
        stopped
          ? { phase: "idle", engine: null, job: null, startedAt: null }
          : { phase: "error", lastError: genericFailure(error), engine: null },
      );
      return;
    }
    if (!this.running) {
      await this.shutdown();
      return;
    }

    try {
      // Pronto para trabalhar, mas sem preferencia: ligado e ocioso, o worker
      // nao toma a fila. A VPS continua processando ate o usuario pedir uma
      // nota neste PC.
      await workerApi.register({
        workerId: this.worker,
        tier: plan.tier,
        preferClient: false,
        models: [plan.whisper.repo, plan.llm.id],
        caps,
      });
      this.preferred = false;
    } catch (error) {
      this.running = false;
      this.update({ phase: "error", lastError: genericFailure(error) });
      await this.shutdown();
      return;
    }

    this.heartbeat = window.setInterval(() => {
      void this.beat();
    }, HEARTBEAT_MS);
    this.statusTimer = window.setInterval(() => {
      void this.refreshStatus();
    }, STATUS_MS);
    this.update({ phase: "waiting" });
    void this.refreshStatus();
    void this.loop();
  }

  private async beat(): Promise<void> {
    try {
      const result = await workerApi.heartbeat(this.worker, this.currentJobId);
      if (result.lost) {
        this.lostJob = true;
        this.engine?.stop();
      }
    } catch {
      // Uma batida perdida nao derruba o modo: a proxima confirma a presenca.
    }
  }

  private async refreshStatus(): Promise<void> {
    try {
      const status = await workerApi.status();
      this.update({ queue: status });
    } catch {
      // status e diagnostico; a fila continua
    }
  }

  private async loop(): Promise<void> {
    let consecutiveFailures = 0;
    while (this.running) {
      this.update({ phase: "waiting", job: null });
      // Sem pedido explicito do usuario, o worker nao reserva nada. O modo
      // ligado so deixa a maquina pronta; a fila continua com a VPS.
      const wanted = this.pendingEntries[0] ?? "";
      if (!wanted) {
        await this.pause(POLL_MS);
        continue;
      }
      let job: WorkerJob | null;
      try {
        const claimed = await workerApi.claim(this.worker, 120, wanted, true);
        job = claimed.job;
      } catch (error) {
        if (error instanceof ApiError && (error.status === 409 || error.status === 404)) {
          // Regra do servidor: sem preferencia ou recurso desligado. Nao e
          // falha de nota; o modo para com uma explicacao.
          this.running = false;
          this.update({ phase: "error", lastError: genericFailure(error) });
          break;
        }
        await this.pause(POLL_MS);
        continue;
      }
      if (!job) {
        // O pedido pode ainda estar chegando na fila. Depois de algumas
        // tentativas, desiste e devolve a preferencia ao servidor.
        this.emptyClaims += 1;
        if (this.emptyClaims >= EMPTY_CLAIMS) {
          this.emptyClaims = 0;
          this.dropEntry(wanted);
          await this.applyPreference();
        }
        await this.pause(POLL_MS);
        continue;
      }
      this.emptyClaims = 0;
      this.currentJobId = job.id;
      this.lostJob = false;
      const entryId = job.payload.entry_id ?? "";
      this.update({
        phase: "working",
        job: {
          id: job.id,
          type: job.type,
          entryId,
          title: "",
          stage: job.type === "transcribe" ? "audio" : "reading",
          read: 0,
          total: 0,
          blockIndex: 0,
          tokensPerSecond: 0,
          startedAt: Date.now(),
        },
      });
      try {
        if (job.type === "transcribe") {
          await this.runTranscription(job);
        } else {
          await this.runAnalysis(job);
        }
        if (!this.lostJob) {
          const completed = await workerApi.complete(this.worker, job.id);
          if (completed.lost) this.lostJob = true;
        }
        if (!this.lostJob) {
          consecutiveFailures = 0;
          this.update({ processed: this.state.processed + 1 });
        }
      } catch (error) {
        if (!this.lostJob) consecutiveFailures += 1;
        const message = genericFailure(error);
        this.update({ failed: this.state.failed + 1, lastError: message });
        if (!this.lostJob) {
          await workerApi.fail(this.worker, job.id, message).catch(() => undefined);
        }
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          this.running = false;
          this.update({ phase: "error", lastError: `Três falhas seguidas: ${message}` });
          break;
        }
      } finally {
        this.currentJobId = "";
        this.updateJob({ stage: "done" });
        // O pedido foi atendido (ou falhou). Sem outro na fila local, a VPS
        // volta a processar; nada e puxado por conta propria.
        this.dropEntry(entryId);
        await this.applyPreference();
      }
      await this.refreshStatus();
    }
    await this.shutdown();
  }

  private async runTranscription(job: WorkerJob): Promise<void> {
    const entryId = job.payload.entry_id ?? "";
    const attachmentId = job.payload.attachment_id ?? "";
    if (!entryId || !attachmentId) throw new Error("job de transcricao incompleto");
    const bundle = await fetchEntryBundle(entryId);
    this.updateJob({ title: bundle.title, entryId });
    const data = await fetchAudio(attachmentId);
    this.updateJob({ stage: "decoding" });
    const decoded = await decodeAudio(data);
    const pcm = await toMono16k(decoded);
    if (this.lostJob) return;
    this.updateJob({ stage: "transcribing" });
    const transcription = await this.transcribe(pcm);
    if (this.lostJob) return;
    await saveTranscript(entryId, {
      attachment_id: attachmentId,
      language: "pt",
      text: transcription.text,
      segments: transcription.segments,
    });
    this.updateJob({
      stage: "transcribed",
      total: transcription.segments.length,
      read: transcription.segments.length,
    });
  }

  private transcribe(pcm: Float32Array): Promise<Transcription> {
    if (!this.engine) throw new Error("engine indisponivel");
    return this.engine.transcribe(pcm);
  }

  private async runAnalysis(job: WorkerJob): Promise<void> {
    const entryId = job.payload.entry_id ?? "";
    if (!entryId) throw new Error("job de analise incompleto");
    if (!this.engine) throw new Error("engine indisponivel");
    const bundle = await fetchEntryBundle(entryId);
    this.updateJob({ title: bundle.title, entryId, stage: "reading" });
    const transcript = bundle.transcript;
    const text = bundle.note.trim();
    const spoken = (transcript?.text ?? "").trim();
    if (text === "" && spoken === "") {
      throw new Error("a nota não tem texto para analisar");
    }
    const segments = (transcript?.segments ?? []).map((segment) => ({
      start_ms: segment.start_ms,
      end_ms: segment.end_ms,
      text: segment.text,
      revised: segment.revised,
    }));
    const result = await this.engine.analyze(
      {
        entryId,
        title: bundle.title,
        text: bundle.note,
        transcript: spoken,
        segments,
        author: authorLabel(
          bundle.entry.author,
          this.settings.owner_name,
          this.settings.all_notes_mine,
        ),
      },
      this.state.plan?.llm.id ?? "",
    );
    if (this.lostJob) return;
    await saveAnalysis(entryId, result.payload, this.replacementEntryId === entryId, this.device ?? undefined);
    if (this.replacementEntryId === entryId) {
      this.replacementEntryId = "";
    }
    this.update({
      debug: result.debug,
      job: this.state.job
        ? {
            ...this.state.job,
            stage: "analyzed",
            read: result.doc.blocksRead,
            total: result.doc.blocksTotal,
          }
        : null,
    });
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.update({ phase: "stopping" });
    // O job em andamento termina e e concluido; so depois o modo desliga. Um
    // resultado perdido no meio do caminho seria pior que esperar.
    if (!this.currentJobId) {
      await this.shutdown();
    }
  }

  /**
   * Devolve o job em andamento para a fila e desliga o worker.
   *
   * Diferente de `stop`, nao espera a nota terminar: e a saida para uma maquina
   * lenta (ou para quando o usuario prefere o servidor). O resultado local que
   * chegar depois e descartado.
   */
  async abandon(): Promise<void> {
    const jobId = this.currentJobId;
    this.running = false;
    this.lostJob = true;
    this.engine?.stop();
    if (jobId !== "") {
      await workerApi.release(this.worker, jobId).catch(() => undefined);
      this.currentJobId = "";
    }
    await this.shutdown();
  }

  /** Identificador estavel da aba, usado pelo aviso de saida da pagina. */
  get id(): string {
    return this.worker;
  }

  private async shutdown(): Promise<void> {
    if (this.heartbeat !== null) {
      window.clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    if (this.statusTimer !== null) {
      window.clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
    this.engine?.dispose();
    this.engine = null;
    await workerApi.unregister(this.worker).catch(() => undefined);
    this.pendingEntries = [];
    this.emptyClaims = 0;
    this.update({
      phase: this.state.phase === "error" ? "error" : "idle",
      job: null,
      engine: null,
      startedAt: null,
    });
  }
}

/** Le as preferencias de autor uma vez, antes de iniciar o worker. */
export async function loadWorkerSettings(): Promise<StoredSettings> {
  try {
    const res = await fetch("/api/v1/settings", {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) throw new Error("settings");
    const body = (await res.json()) as Settings;
    return { owner_name: body.owner_name ?? "", all_notes_mine: body.all_notes_mine !== false };
  } catch {
    return { owner_name: "", all_notes_mine: true };
  }
}
