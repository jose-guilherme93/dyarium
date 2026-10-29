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
  planForTier,
  type BrowserPlan,
  type ProcessingTier,
} from "./browserModels";
import { chooseTier, type HardwareSnapshot, type HardwareVerdict } from "./hardware";
import { loadDeviceIdentity, type DeviceIdentity } from "./deviceIdentity";
import { probeHardware } from "./hardwareProbe";

const PLAN_KEY = "dyarium.worker.plan";
const THREADS_KEY = "dyarium.worker.threads";

/** Quantos nucleos o llama.cpp pode usar na analise. */
export type ThreadMode = "all" | "half";

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
  allowGpu: boolean;
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
    threads: snapshot.cpu.threads,
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
  const base = planForTier(tier);
  const plan: BrowserPlan = {
    ...base,
    whisper: WHISPER_MODELS.find((model) => model.id === saved?.whisperId) ?? base.whisper,
    llm: LLM_MODELS.find((model) => model.id === saved?.llmId) ?? base.llm,
  };
  return {
    snapshot,
    verdict,
    plan,
    caps: splitCaps(snapshot),
    allowGpu: snapshot.webgpu.available && verdict.gpu?.label !== "GPU de software",
    threads: threadsFor(readThreadMode(), snapshot.cpu.threads),
    device: loadDeviceIdentity(snapshot),
  };
}
