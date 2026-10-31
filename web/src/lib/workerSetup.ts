/**
 * Escolha e memoria do perfil de processamento.
 *
 * O laboratorio salva o perfil que o usuario escolheu; o botao da nota usa o
 * mesmo perfil, ou detecta o hardware e aplica a recomendacao na primeira vez.
 * Assim o usuario nao precisa passar pelo laboratorio para analisar uma nota.
 */

import {
  LLM_MODELS,
  WHISPER_MODELS,
  cpuWhisper,
  planForTier,
  type BrowserPlan,
  type ProcessingTier,
} from "./browserModels";
import { chooseTier, webGpuUsable, type HardwareSnapshot, type HardwareVerdict } from "./hardware";
import { loadDeviceIdentity, type DeviceIdentity } from "./deviceIdentity";
import { probeHardware } from "./hardwareProbe";

const PLAN_KEY = "dyarium.worker.plan";
const THREADS_KEY = "dyarium.worker.threads";
const BACKEND_KEY = "dyarium.worker.backend";

/** Quantos nucleos o llama.cpp pode usar na analise. */
export type ThreadMode = "all" | "half";

/**
 * Onde a analise roda. `auto` usa a GPU quando o navegador entrega um adaptador
 * de verdade; `cpu` forca os nucleos mesmo com GPU presente (um offload ruim
 * deixa um nucleo ocupado e a placa esperando).
 */
export type LlmBackend = "auto" | "cpu" | "gpu";

interface SavedPlan {
  tier: ProcessingTier;
  whisperId?: string;
  llmId?: string;
}

export interface WorkerSetup {
  snapshot: HardwareSnapshot;
  verdict: HardwareVerdict;
  plan: BrowserPlan;
  caps: ReturnType<typeof splitCaps>;
  /** A GPU foi escolhida para a analise (e o navegador a entrega). */
  allowGpu: boolean;
  backend: LlmBackend;
  /** Nucleos entregues ao llama.cpp. */
  threads: number;
  /** Aparelho que vai assinar a analise. */
  device: DeviceIdentity;
}

let detection: Promise<HardwareSnapshot> | null = null;

/**
 * O llama.cpp e o ONNX so abrem mais de uma thread com `SharedArrayBuffer`, que
 * exige contexto isolado (HTTPS com COOP/COEP). Sem isso, o motor roda em uma
 * thread e um modelo grande nao termina em tempo util: a recomendacao cai para
 * o perfil minimo.
 */
export function multithreadAvailable(): boolean {
  try {
    return (
      typeof SharedArrayBuffer !== "undefined" &&
      (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true
    );
  } catch {
    return false;
  }
}

/** Detecta uma vez por carregamento; a nota e o laboratorio compartilham. */
export function detectHardwareOnce(): Promise<HardwareSnapshot> {
  detection ??= probeHardware();
  return detection;
}

/** O que o servidor precisa saber sobre a maquina que assumiu a fila. */
export function splitCaps(snapshot: HardwareSnapshot) {
  return {
    browser: snapshot.browser,
    gpu: snapshot.webgpu.adapter?.description || snapshot.webgl.renderer || "",
    vram_gb: snapshot.memory.vramGB,
    ram_gb: snapshot.memory.deviceMemoryGB ?? snapshot.memory.heapLimitGB,
    // O servidor mostra a capacidade real; sem isolamento o motor nao abre o pool.
    threads: multithreadAvailable() ? snapshot.cpu.threads : 1,
    webgpu: snapshot.webgpu.available,
    gflops: snapshot.cpu.gflops,
  };
}

export function readThreadMode(): ThreadMode {
  try {
    return localStorage.getItem(THREADS_KEY) === "half" ? "half" : "all";
  } catch {
    return "all";
  }
}

export function saveThreadMode(mode: ThreadMode): void {
  try {
    localStorage.setItem(THREADS_KEY, mode);
  } catch {
    // sem localStorage: vale so para esta sessao
  }
}

export function readBackend(): LlmBackend {
  try {
    const saved = localStorage.getItem(BACKEND_KEY);
    return saved === "cpu" || saved === "gpu" ? saved : "auto";
  } catch {
    return "auto";
  }
}

export function saveBackend(backend: LlmBackend): void {
  try {
    localStorage.setItem(BACKEND_KEY, backend);
  } catch {
    // sem localStorage: vale so para esta sessao
  }
}

/** A GPU so entra quando existe adaptador utilizavel e o usuario nao negou. */
export function allowGpuFor(snapshot: HardwareSnapshot, backend: LlmBackend): boolean {
  return backend !== "cpu" && webGpuUsable(snapshot);
}

/** Nucleos que realmente entram no motor; sem isolamento o runtime cai para 1. */
export function effectiveThreads(mode: ThreadMode, cores?: number): number {
  return multithreadAvailable() ? threadsFor(mode, cores) : 1;
}

/**
 * Perfil com o Whisper que cabe na maquina. O ONNX roda em uma thread (o
 * runtime trava ao abrir o pool dentro do Web Worker), entao o large-v3-turbo
 * so entra quando ha WebGPU; sem ela, a transcricao usaria o modelo pequeno.
 */
export function planForSnapshot(tier: ProcessingTier, snapshot: HardwareSnapshot): BrowserPlan {
  const base = planForTier(tier);
  if (webGpuUsable(snapshot)) return base;
  return { ...base, whisper: cpuWhisper(base.whisper) };
}

/**
 * Nucleos para o llama.cpp. O padrao e usar todos: numa CPU antiga ou numa GPU
 * integrada, deixar nucleos de fora so aumenta o tempo da nota. "Metade" existe
 * para quem precisa da maquina respondendo enquanto processa.
 */
export function threadsFor(mode: ThreadMode, cores?: number): number {
  const total = Math.max(1, cores ?? navigator.hardwareConcurrency ?? 2);
  const wanted = mode === "half" ? Math.floor(total / 2) : total;
  return Math.max(1, Math.min(32, wanted));
}

function isTier(value: unknown): value is ProcessingTier {
  return value === 0 || value === 1 || value === 2 || value === 3 || value === 4;
}

function readSavedPlan(): SavedPlan | null {
  try {
    const raw = localStorage.getItem(PLAN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedPlan>;
    if (!isTier(parsed.tier)) return null;
    return {
      tier: parsed.tier,
      whisperId: typeof parsed.whisperId === "string" ? parsed.whisperId : undefined,
      llmId: typeof parsed.llmId === "string" ? parsed.llmId : undefined,
    };
  } catch {
    return null;
  }
}

/** Guarda a escolha do laboratorio para o botao da nota usar o mesmo perfil. */
export function saveWorkerPlan(plan: BrowserPlan): void {
  try {
    localStorage.setItem(
      PLAN_KEY,
      JSON.stringify({ tier: plan.tier, whisperId: plan.whisper.id, llmId: plan.llm.id }),
    );
  } catch {
    // sem localStorage: o perfil vale so para esta sessao
  }
}

/** Perfil pronto para ligar o worker sem abrir o laboratorio. */
export async function prepareWorkerSetup(): Promise<WorkerSetup> {
  const snapshot = await detectHardwareOnce();
  const verdict = chooseTier(snapshot);
  const saved = readSavedPlan();
  const recommended = (multithreadAvailable()
    ? verdict.tier
    : Math.min(verdict.tier, 0)) as ProcessingTier;
  // Uma escolha explicita do laboratorio vence a recomendacao.
  const tier = saved?.tier ?? recommended;
  const base = planForSnapshot(tier, snapshot);
  // Um Whisper grande salvo antes (ou escolhido a mao) nao pode voltar quando a
  // GPU sumiu: em uma thread ele levaria a nota inteira para horas.
  const savedWhisper = WHISPER_MODELS.find((model) => model.id === saved?.whisperId);
  const whisper =
    savedWhisper &&
    (webGpuUsable(snapshot) || savedWhisper.id !== "whisper-large-v3-turbo")
      ? savedWhisper
      : base.whisper;
  const plan: BrowserPlan = {
    ...base,
    whisper,
    llm: LLM_MODELS.find((model) => model.id === saved?.llmId) ?? base.llm,
  };
  const backend = readBackend();
  return {
    snapshot,
    verdict,
    plan,
    caps: splitCaps(snapshot),
    allowGpu: allowGpuFor(snapshot, backend),
    backend,
    threads: effectiveThreads(readThreadMode(), snapshot.cpu.threads),
    device: loadDeviceIdentity(snapshot),
  };
}
