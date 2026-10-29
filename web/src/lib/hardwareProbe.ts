/**
 * Sondagem do navegador: features, GPU, memoria e benchmarks.
 *
 * Tudo aqui e local. Nenhuma informacao do ambiente sai do computador: o
 * relatorio fica na tela e, se o usuario pedir, vira um JSON para ele guardar.
 */

import {
  chooseTier,
  detectBrowser,
  vramFromAdapter,
  type GpuAdapterInfo,
  type HardwareSnapshot,
  type HardwareVerdict,
  type WebGpuReason,
} from "./hardware";

interface NavigatorWithHints {
  gpu?: GPU;
  deviceMemory?: number;
  userAgentData?: {
    platform?: string;
    getHighEntropyValues(hints: string[]): Promise<{ architecture?: string; bitness?: string; platform?: string }>;
  };
}

// Constantes do WebGPU. O TypeScript do projeto conhece os tipos, nao os
// valores globais; os numeros sao fixos na especificacao.
const BUFFER_STORAGE = 0x0080;
const BUFFER_COPY_DST = 0x0008;

interface PerformanceWithMemory extends Performance {
  memory?: { jsHeapSizeLimit?: number; usedJSHeapSize?: number };
}

function gb(bytes: number | null | undefined): number | null {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return null;
  return bytes / 1024 ** 3;
}

function roundGB(value: number | null): number | null {
  if (value === null) return null;
  return Math.round(value * 10) / 10;
}

function webglRenderer(): { renderer: string; vendor: string } {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return { renderer: "", vendor: "" };
    // 0x9246 = UNMASKED_RENDERER_WEBGL; 0x9245 = UNMASKED_VENDOR_WEBGL.
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = debug
      ? String(gl.getParameter(0x9246) ?? "")
      : String(gl.getParameter(gl.RENDERER) ?? "");
    const vendor = debug
      ? String(gl.getParameter(0x9245) ?? "")
      : String(gl.getParameter(gl.VENDOR) ?? "");
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return { renderer, vendor };
  } catch {
    return { renderer: "", vendor: "" };
  }
}

async function probeWebGpu(): Promise<{
  available: boolean;
  adapter: GpuAdapterInfo | null;
  reason: WebGpuReason;
}> {
  const nav = navigator as unknown as NavigatorWithHints;
  const secure = typeof window === "undefined" || window.isSecureContext !== false;
  if (!nav.gpu) {
    // WebGPU so existe em contexto seguro. Dizer "sem HTTPS" evita a impressao
    // de que o navegador nao suporta.
    return { available: false, adapter: null, reason: secure ? "unsupported" : "insecure" };
  }
  const request = async (options?: GPURequestAdapterOptions) => {
    try {
      return await nav.gpu!.requestAdapter(options);
    } catch {
      return null;
    }
  };
  // `high-performance` falha em alguns drivers antigos; sem preferencia costuma
  // devolver o adaptador integrado.
  const adapter = (await request({ powerPreference: "high-performance" })) ?? (await request());
  if (!adapter) return { available: false, adapter: null, reason: "no-adapter" };
  try {
    // `info` is the current spec; older builds expose requestAdapterInfo().
    const legacy = adapter as GPUAdapter & { requestAdapterInfo?: () => Promise<GPUAdapterInfo> };
    const info =
      ((adapter as GPUAdapter & { info?: GPUAdapterInfo }).info ??
        (legacy.requestAdapterInfo ? await legacy.requestAdapterInfo() : null)) || null;
    // Adaptador de software (SwiftShader, llvmpipe) existe, mas e mais lento que
    // a CPU; o laboratorio marca para o usuario nao confiar nele.
    const software =
      (info as (GPUAdapterInfo & { isFallbackAdapter?: boolean }) | null)?.isFallbackAdapter === true ||
      /swiftshader|llvmpipe|softpipe|software|microsoft basic/i.test(
        [info?.description, info?.device, info?.architecture, info?.vendor].filter(Boolean).join(" "),
      );
    return {
      available: true,
      reason: software ? "software" : "ok",
      adapter: {
        vendor: info?.vendor || undefined,
        architecture: info?.architecture || undefined,
        device: info?.device || undefined,
        description: info?.description || undefined,
        maxBufferSize: adapter.limits.maxBufferSize,
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      },
    };
  } catch {
    return { available: false, adapter: null, reason: "no-adapter" };
  }
}

/** Exportado para o teste: um modulo invalido aqui desligaria o modo inteiro. */
export function wasmSimd(): boolean {
  try {
    // (module (func (result v128) i32.const 0 i8x16.splat))
    const bytes = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b,
      0x03, 0x02, 0x01, 0x00, 0x0a, 0x08, 0x01, 0x06, 0x00, 0x41, 0x00, 0xfd, 0x0f, 0x0b,
    ]);
    return WebAssembly.validate(bytes);
  } catch {
    return false;
  }
}

/** Retrato do ambiente. Nao roda benchmark: a maquina nao pode travar ao abrir. */
export async function probeHardware(): Promise<HardwareSnapshot> {
  const nav = navigator as unknown as NavigatorWithHints;
  const perf = performance as PerformanceWithMemory;
  const gpu = await probeWebGpu();
  const gl = webglRenderer();

  let quotaGB: number | null = null;
  let usageGB: number | null = null;
  try {
    const estimate = await navigator.storage?.estimate?.();
    quotaGB = roundGB(gb(estimate?.quota));
    usageGB = roundGB(gb(estimate?.usage));
  } catch {
    // sem a API de armazenamento: a tela mostra "—"
  }

  const heapLimit = gb(perf.memory?.jsHeapSizeLimit);

  const snapshot: HardwareSnapshot = {
    userAgent: navigator.userAgent,
    browser: detectBrowser(navigator.userAgent),
    platform: nav.userAgentData?.platform || navigator.platform || "",
    webgpu: gpu,
    webgl: gl,
    cpu: {
      threads: Math.max(1, navigator.hardwareConcurrency || 1),
      gflops: null,
    },
    memory: {
      deviceMemoryGB: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
      heapLimitGB: roundGB(heapLimit),
      vramGB: vramFromAdapter(gpu.adapter),
      vramSource: gpu.adapter ? "table" : "unknown",
    },
    storage: { quotaGB, usageGB },
    features: {
      wasmSimd: typeof WebAssembly === "object" && wasmSimd(),
      sharedArrayBuffer: typeof SharedArrayBuffer === "function",
      crossOriginIsolated: Boolean(globalThis.crossOriginIsolated),
      offscreenCanvas: typeof OffscreenCanvas === "function",
      webCodecs: typeof AudioDecoder === "function",
      audioContext: typeof AudioContext === "function",
      opfs: Boolean(navigator.storage?.getDirectory),
      indexedDB: typeof indexedDB === "object",
      wakeLock: "wakeLock" in navigator,
    },
    measuredAt: new Date().toISOString(),
  };

  // A RAM do Chrome as vezes aparece so no heap; guardar o maior valor ajuda o
  // tier. deviceMemory e arredondado para baixo, nunca para cima.
  if (snapshot.memory.deviceMemoryGB !== null && snapshot.memory.heapLimitGB !== null) {
    snapshot.memory.heapLimitGB = Math.max(
      snapshot.memory.deviceMemoryGB,
      snapshot.memory.heapLimitGB,
    );
  }
  return snapshot;
}

/** Benchmark de CPU em JavaScript puro: multiplicacao de matrizes float32. */
export async function benchmarkCpu(durationMs = 350): Promise<number> {
  const n = 96;
  const a = new Float32Array(n * n);
  const b = new Float32Array(n * n);
  const c = new Float32Array(n * n);
  for (let i = 0; i < n * n; i += 1) {
    a[i] = (i % 17) / 17;
    b[i] = (i % 13) / 13;
  }
  const multiply = () => {
    c.fill(0);
    for (let i = 0; i < n; i += 1) {
      for (let k = 0; k < n; k += 1) {
        const aik = a[i * n + k];
        for (let j = 0; j < n; j += 1) {
          c[i * n + j] += aik * b[k * n + j];
        }
      }
    }
  };
  // Aquecimento: a primeira chamada paga a compilacao do laco.
  multiply();
  const started = performance.now();
  let runs = 0;
  while (performance.now() - started < durationMs) {
    multiply();
    runs += 1;
  }
  const seconds = (performance.now() - started) / 1000;
  const flops = runs * 2 * n ** 3;
  return Math.round((flops / seconds / 1e9) * 10) / 10;
}

const GPU_BENCH_WGSL = `
@group(0) @binding(0) var<storage, read_write> data: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  var value = data[i];
  for (var k = 0u; k < 64u; k = k + 1u) {
    value = value * 1.000001 + 0.000001;
  }
  data[i] = value;
}
`;

/** Benchmark de GPU com um compute shader WGSL. null quando nao ha WebGPU. */
export async function benchmarkGpu(durationMs = 450): Promise<number | null> {
  const nav = navigator as unknown as NavigatorWithHints;
  if (!nav.gpu) return null;
  try {
    const adapter = await nav.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    const module = device.createShaderModule({ code: GPU_BENCH_WGSL });
    const pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: "main" },
    });
    const count = 262_144;
    const buffer = device.createBuffer({
      size: count * 4,
      usage: BUFFER_STORAGE | BUFFER_COPY_DST,
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer } }],
    });
    const workgroups = Math.ceil(count / 64);
    const dispatch = () => {
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(workgroups);
      pass.end();
      device.queue.submit([encoder.finish()]);
    };
    dispatch();
    await device.queue.onSubmittedWorkDone();
    const started = performance.now();
    let runs = 0;
    while (performance.now() - started < durationMs) {
      dispatch();
      runs += 1;
      if (runs % 8 === 0) await device.queue.onSubmittedWorkDone();
    }
    await device.queue.onSubmittedWorkDone();
    const seconds = (performance.now() - started) / 1000;
    const flops = runs * count * 64 * 2;
    buffer.destroy();
    device.destroy();
    return Math.round((flops / seconds / 1e9) * 10) / 10;
  } catch {
    return null;
  }
}

/**
 * Teste de alocacao: a maior memoria de GPU que o navegador aceita guardar de
 * uma vez. Nao e a VRAM total (o driver pode comprimir ou paginar), mas e um
 * piso util quando o nome da placa nao esta na tabela.
 */
export async function probeVram(): Promise<number | null> {
  const nav = navigator as unknown as NavigatorWithHints;
  if (!nav.gpu) return null;
  let device: GPUDevice | null = null;
  const buffers: GPUBuffer[] = [];
  try {
    const adapter = await nav.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return null;
    device = await adapter.requestDevice();
    const step = 256 * 1024 * 1024;
    let allocated = 0;
    for (let size = step; size <= 8 * 1024 ** 3; size += step) {
      const buffer = device.createBuffer({
        size,
        usage: BUFFER_STORAGE | BUFFER_COPY_DST,
      });
      // Uma escrita minima forca o driver a materializar a alocacao.
      device.queue.writeBuffer(buffer, 0, new Uint8Array(4));
      await device.queue.onSubmittedWorkDone();
      buffers.push(buffer);
      allocated = size;
    }
    return Math.round((allocated / 1024 ** 3) * 10) / 10;
  } catch {
    // O erro de alocacao e a resposta esperada: devolve o ultimo tamanho que
    // funcionou, que os buffers guardados ainda representam.
    let allocated = 0;
    for (const buffer of buffers) allocated += buffer.size;
    return allocated > 0 ? Math.round((allocated / 1024 ** 3) * 10) / 10 : null;
  } finally {
    for (const buffer of buffers) buffer.destroy();
    device?.destroy();
  }
}

/** Relatorio completo: retrato + benchmarks + veredito do tier. */
export interface LabReport {
  hardware: HardwareSnapshot;
  verdict: HardwareVerdict;
  cpuGflops: number | null;
  gpuGflops: number | null;
  vramProbeGB: number | null;
  generatedAt: string;
}

export async function buildLabReport(
  snapshot: HardwareSnapshot,
  options: { cpu?: boolean; gpu?: boolean; vram?: boolean } = {},
): Promise<LabReport> {
  const hardware: HardwareSnapshot = {
    ...snapshot,
    cpu: { ...snapshot.cpu },
    memory: { ...snapshot.memory },
  };
  if (options.cpu) {
    hardware.cpu.gflops = await benchmarkCpu();
  }
  const gpuGflops = options.gpu ? await benchmarkGpu() : null;
  const vramProbeGB = options.vram ? await probeVram() : null;
  if (vramProbeGB !== null) {
    hardware.memory.vramGB = vramProbeGB;
    hardware.memory.vramSource = "probe";
  }
  return {
    hardware,
    verdict: chooseTier(hardware),
    cpuGflops: hardware.cpu.gflops,
    gpuGflops,
    vramProbeGB,
    generatedAt: new Date().toISOString(),
  };
}
