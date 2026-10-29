/**
 * Deteccao de hardware do navegador e escolha do perfil de processamento.
 *
 * A WebGPU nao expoe a VRAM e o `navigator.deviceMemory` e arredondado (e
 * limitado a 8 em muitos navegadores). Por isso a escolha combina quatro
 * sinais: o nome da GPU, a tabela de placas conhecidas, os limites do adaptador
 * e a RAM aproximada. O laboratorio deixa o usuario corrigir o resultado.
 *
 * As funcoes puras recebem um retrato do ambiente (HardwareSnapshot) para
 * poderem ser testadas sem navegador.
 */

import type { ProcessingTier } from "./browserModels";

export type BrowserEngine = "chromium" | "firefox" | "safari" | "unknown";

export interface BrowserInfo {
  engine: BrowserEngine;
  name: string;
  version: string;
}

export interface GpuAdapterInfo {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
  maxBufferSize?: number;
  maxStorageBufferBindingSize?: number;
}

/** Por que a WebGPU esta (ou nao) disponivel. */
export type WebGpuReason = "ok" | "insecure" | "unsupported" | "no-adapter" | "software";

export interface HardwareSnapshot {
  userAgent: string;
  browser: BrowserInfo;
  /** Sistema operacional informado pelo navegador ("Windows", "Linux"...). */
  platform?: string;
  webgpu: {
    available: boolean;
    adapter: GpuAdapterInfo | null;
    reason?: WebGpuReason;
  };
  webgl: {
    renderer: string;
    vendor: string;
  };
  cpu: {
    threads: number;
    /** GFLOPs medidos; null quando o benchmark nao rodou. */
    gflops: number | null;
  };
  memory: {
    /** `navigator.deviceMemory`, em GB. Limitado a 8 pelos navegadores. */
    deviceMemoryGB: number | null;
    /** Limite do heap JS, quando o navegador expoe. */
    heapLimitGB: number | null;
    /** VRAM estimada ou medida pelo laboratorio. */
    vramGB: number | null;
    /** De onde veio a estimativa de VRAM. */
    vramSource: "table" | "probe" | "manual" | "unknown";
  };
  storage: {
    quotaGB: number | null;
    usageGB: number | null;
  };
  features: {
    wasmSimd: boolean;
    sharedArrayBuffer: boolean;
    crossOriginIsolated: boolean;
    offscreenCanvas: boolean;
    webCodecs: boolean;
    audioContext: boolean;
    opfs: boolean;
    indexedDB: boolean;
    wakeLock: boolean;
  };
  measuredAt: string;
}

export interface KnownGpu {
  label: string;
  vramGB: number;
  tier: ProcessingTier;
}

export interface HardwareVerdict {
  tier: ProcessingTier;
  gpu: KnownGpu | null;
  /** Por que este tier foi escolhido, em uma linha para a tela. */
  reason: string;
  /** Avisos que mudam a expectativa (sem WebGPU, RAM desconhecida...). */
  warnings: string[];
  /** O navegador entrega tudo o que o worker precisa? */
  fullSupport: boolean;
}

/**
 * Placas comuns no publico do produto. A ordem importa: a primeira expressao
 * que casa vence, entao as mais especificas vem antes.
 */
export const KNOWN_GPUS: { pattern: RegExp; gpu: KnownGpu }[] = [
  { pattern: /\brx\s?580\b/i, gpu: { label: "AMD Radeon RX 580", vramGB: 8, tier: 3 } },
  { pattern: /\brx\s?570\b/i, gpu: { label: "AMD Radeon RX 570", vramGB: 4, tier: 2 } },
  { pattern: /\brx\s?6600\b/i, gpu: { label: "AMD Radeon RX 6600", vramGB: 8, tier: 3 } },
  { pattern: /\brx\s?7600\b/i, gpu: { label: "AMD Radeon RX 7600", vramGB: 8, tier: 3 } },
  { pattern: /\bgtx\s?1060\b.*\b3\s?gb\b/i, gpu: { label: "NVIDIA GTX 1060 3 GB", vramGB: 3, tier: 2 } },
  { pattern: /\bgtx\s?1060\b/i, gpu: { label: "NVIDIA GTX 1060", vramGB: 6, tier: 3 } },
  { pattern: /\bgtx\s?1650\b/i, gpu: { label: "NVIDIA GTX 1650", vramGB: 4, tier: 2 } },
  { pattern: /\bgtx\s?1660\b/i, gpu: { label: "NVIDIA GTX 1660", vramGB: 6, tier: 3 } },
  { pattern: /\brtx\s?20\d0\b/i, gpu: { label: "NVIDIA RTX 20 series", vramGB: 8, tier: 3 } },
  { pattern: /\brtx\s?30[6-9]0\b/i, gpu: { label: "NVIDIA RTX 30 series", vramGB: 12, tier: 4 } },
  { pattern: /\brtx\s?40[7-9]0\b/i, gpu: { label: "NVIDIA RTX 40 series", vramGB: 16, tier: 4 } },
  { pattern: /\brtx\s?50[7-9]0\b/i, gpu: { label: "NVIDIA RTX 50 series", vramGB: 16, tier: 4 } },
  { pattern: /\brx\s?6800\b/i, gpu: { label: "AMD Radeon RX 6800", vramGB: 16, tier: 4 } },
  { pattern: /\brx\s?7800\b/i, gpu: { label: "AMD Radeon RX 7800", vramGB: 16, tier: 4 } },
  { pattern: /\barc\s?a7\d0\b/i, gpu: { label: "Intel Arc A7", vramGB: 16, tier: 4 } },
  // Integradas: compartilham a RAM do sistema e nao devem receber tier alto.
  { pattern: /\biris\b/i, gpu: { label: "Intel Iris", vramGB: 0, tier: 1 } },
  { pattern: /\buhd graphics\b/i, gpu: { label: "Intel UHD Graphics", vramGB: 0, tier: 1 } },
  { pattern: /\bhd graphics\b/i, gpu: { label: "Intel HD Graphics", vramGB: 0, tier: 1 } },
  { pattern: /\bapple m[1-4]\b/i, gpu: { label: "Apple Silicon", vramGB: 8, tier: 3 } },
  { pattern: /\bllvmpipe\b|\bswiftshader\b|\bsoftware rasterizer\b/i, gpu: { label: "GPU de software", vramGB: 0, tier: 0 } },
];

/** Identifica o navegador pelo User-Agent. Edge vem antes do Chrome. */
export function detectBrowser(userAgent: string): BrowserInfo {
  const ua = userAgent ?? "";
  const version = (pattern: RegExp): string => pattern.exec(ua)?.[1] ?? "";
  if (/Edg\//.test(ua)) return { engine: "chromium", name: "Edge", version: version(/Edg\/([\d.]+)/) };
  if (/OPR\//.test(ua)) return { engine: "chromium", name: "Opera", version: version(/OPR\/([\d.]+)/) };
  if (/Firefox\//.test(ua)) return { engine: "firefox", name: "Firefox", version: version(/Firefox\/([\d.]+)/) };
  if (/Chrome\//.test(ua)) return { engine: "chromium", name: "Chrome", version: version(/Chrome\/([\d.]+)/) };
  if (/Safari\//.test(ua) && /Version\//.test(ua)) {
    return { engine: "safari", name: "Safari", version: version(/Version\/([\d.]+)/) };
  }
  return { engine: "unknown", name: "Navegador", version: "" };
}

function gpuHaystack(snapshot: HardwareSnapshot): string {
  const adapter = snapshot.webgpu.adapter;
  return [
    snapshot.webgl.renderer,
    snapshot.webgl.vendor,
    adapter?.description,
    adapter?.device,
    adapter?.architecture,
    adapter?.vendor,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Primeira placa conhecida que casa com o renderer ou com o adaptador. */
export function knownGpuFor(snapshot: HardwareSnapshot): KnownGpu | null {
  const haystack = gpuHaystack(snapshot);
  for (const entry of KNOWN_GPUS) {
    if (entry.pattern.test(haystack)) {
      return entry.gpu;
    }
  }
  return null;
}

/** RAM plausivel: deviceMemory e arredondado; o heap do Chrome revela mais. */
function ramGB(snapshot: HardwareSnapshot): number | null {
  const values = [snapshot.memory.deviceMemoryGB, snapshot.memory.heapLimitGB].filter(
    (value): value is number => typeof value === "number" && value > 0,
  );
  if (values.length === 0) return null;
  return Math.max(...values);
}

function clampTier(value: number): ProcessingTier {
  if (value <= 0) return 0;
  if (value >= 4) return 4;
  return Math.round(value) as ProcessingTier;
}

/**
 * Escolhe o maior tier que a maquina comporta. A qualidade vem primeiro: uma
 * GPU de 8 GB recebe 2.6B, nao o modelo de 230M; o usuario ainda pode descer.
 */
export function chooseTier(snapshot: HardwareSnapshot): HardwareVerdict {
  const gpu = knownGpuFor(snapshot);
  const ram = ramGB(snapshot);
  const warnings: string[] = [];

  let tier: number;
  if (gpu) {
    tier = gpu.tier;
  } else if (snapshot.webgpu.available) {
    tier = 2;
    warnings.push("GPU não reconhecida: o perfil foi estimado pelos limites do adaptador.");
  } else {
    tier = 1;
    switch (snapshot.webgpu.reason) {
      case "insecure":
        warnings.push("WebGPU exige HTTPS: neste endereço a GPU fica de fora e só a CPU processa.");
        break;
      case "no-adapter":
        warnings.push("WebGPU sem adaptador (driver ou bloqueio): só a CPU processa.");
        break;
      case "unsupported":
        warnings.push("Este navegador não expõe WebGPU: só a CPU processa.");
        break;
      default:
        warnings.push("WebGPU indisponível: a GPU fica de fora e só a CPU processa.");
    }
  }

  const vram = snapshot.memory.vramGB ?? gpu?.vramGB ?? null;
  if (vram !== null && vram > 0) {
    if (vram >= 10) tier = Math.max(tier, 4);
    else if (vram >= 6) tier = Math.max(tier, 3);
    else if (vram >= 2.5) tier = Math.max(tier, 2);
    else tier = Math.min(tier, 1);
  }

  if (ram !== null) {
    if (ram < 6) {
      tier = Math.min(tier, 1);
      warnings.push("Pouca RAM: ficamos no perfil leve para não travar a aba.");
    } else if (ram < 10) {
      tier = Math.min(tier, ram < 8 ? 1 : 2);
    } else if (ram < 14) {
      tier = Math.min(tier, 3);
    }
  } else {
    warnings.push("O navegador não informou a RAM; a escolha usou só a GPU.");
  }

  // O benchmark e JavaScript puro e serve para separar uma CPU muito fraca de
  // uma comum; o numero nao e comparavel a GFLOPs nativas. So demove quando o
  // resultado e claramente insuficiente, para uma medicao pessimista nao jogar
  // uma maquina de 16 GB no perfil minimo.
  if (snapshot.cpu.gflops !== null && snapshot.cpu.gflops < 0.5) {
    tier = 0;
    warnings.push("CPU muito lenta no teste: mesmo o perfil mínimo vai demorar.");
  }

  const browser = snapshot.browser;
  let fullSupport = true;
  if (browser.engine === "firefox") {
    if (!snapshot.webgpu.available) {
      warnings.push("Firefox sem WebGPU: transcrição e análise rodam em WebAssembly (mais lento).");
      fullSupport = snapshot.features.wasmSimd;
    } else {
      warnings.push("Firefox com WebGPU: a transcrição usa a GPU; a análise usa a CPU.");
    }
  } else if (browser.engine === "safari") {
    warnings.push("Safari tem suporte mais restrito; meça no laboratório antes de confiar.");
  } else if (browser.engine === "unknown") {
    warnings.push("Navegador não reconhecido: use Edge, Chrome ou Firefox.");
    fullSupport = false;
  }
  if (!snapshot.features.wasmSimd) {
    warnings.push("Sem WebAssembly SIMD: o processamento local fica inviável.");
    fullSupport = false;
  }
  if (!snapshot.features.sharedArrayBuffer) {
    warnings.push("Sem threads (SharedArrayBuffer): o modelo roda em um núcleo só.");
  }

  const reason = gpu
    ? `${gpu.label} (${gpu.vramGB > 0 ? `${gpu.vramGB} GB de VRAM` : "memória compartilhada"})`
    : snapshot.webgpu.available
      ? "GPU WebGPU não identificada"
      : "somente CPU";

  return { tier: clampTier(tier), gpu, reason, warnings, fullSupport };
}

/** Estimativa conservadora de VRAM a partir dos limites do adaptador. */
export function vramFromAdapter(adapter: GpuAdapterInfo | null): number | null {
  if (!adapter?.maxBufferSize) return null;
  const bytes = adapter.maxBufferSize;
  // O limite de um buffer costuma ser 1/4 da VRAM no Chrome. E um piso, nao
  // uma medida: o laboratorio oferece o teste de alocacao para confirmar.
  const estimate = (bytes / 1024 ** 3) * 4;
  return Math.max(1, Math.round(estimate));
}

/** Resumo curto para a tela: "Firefox 144 · Intel HD Graphics 530 · 8 núcleos". */
/**
 * Rotulo curto da WebGPU para o laboratorio: diz tambem por que ela falta, para
 * "não" nao parecer defeito quando o navegador so exige HTTPS.
 */
export function webGpuLabel(snapshot: HardwareSnapshot): string {
  if (snapshot.webgpu.available) {
    return snapshot.webgpu.reason === "software" ? "software" : "sim";
  }
  switch (snapshot.webgpu.reason) {
    case "insecure":
      return "não · HTTPS";
    case "no-adapter":
      return "não · driver";
    case "unsupported":
      return "não · navegador";
    default:
      return "não";
  }
}

export function hardwareSummary(snapshot: HardwareSnapshot): string {
  const gpu = snapshot.webgpu.adapter?.description || snapshot.webgl.renderer || "GPU desconhecida";
  const browser = `${snapshot.browser.name}${snapshot.browser.version ? ` ${snapshot.browser.version}` : ""}`;
  return `${browser} · ${gpu} · ${snapshot.cpu.threads} núcleos`;
}
