import { describe, expect, it } from "vitest";
import type { HardwareSnapshot } from "./hardware";
import {
  allowGpuFor,
  planForSnapshot,
  threadsFor,
  type LlmBackend,
} from "./workerSetup";

function snapshot(overrides: Partial<HardwareSnapshot> = {}): HardwareSnapshot {
  return {
    userAgent: "Mozilla/5.0",
    browser: { engine: "chromium", name: "Chrome", version: "140" },
    webgpu: { available: true, adapter: null, reason: "ok" },
    webgl: { renderer: "AMD Radeon RX 580 Series", vendor: "AMD" },
    cpu: { threads: 14, gflops: 20 },
    memory: { deviceMemoryGB: 8, heapLimitGB: 16, vramGB: 8, vramSource: "table" },
    storage: { quotaGB: 200, usageGB: 1 },
    features: {
      wasmSimd: true,
      sharedArrayBuffer: true,
      crossOriginIsolated: true,
      offscreenCanvas: true,
      webCodecs: true,
      audioContext: true,
      opfs: true,
      indexedDB: true,
      wakeLock: true,
    },
    measuredAt: "2026-10-30T12:00:00.000Z",
    ...overrides,
  };
}

function backend(value: LlmBackend) {
  return allowGpuFor(snapshot(), value);
}

describe("allowGpuFor", () => {
  it("uses the GPU only when the browser exposes a real adapter", () => {
    expect(backend("auto")).toBe(true);
    expect(backend("gpu")).toBe(true);
    expect(backend("cpu")).toBe(false);
  });

  it("never sends an analysis to a software GPU", () => {
    const software = snapshot({ webgpu: { available: true, adapter: null, reason: "software" } });
    expect(allowGpuFor(software, "auto")).toBe(false);
  });

  it("falls back to the CPU when WebGPU is missing", () => {
    const noGpu = snapshot({ webgpu: { available: false, adapter: null, reason: "no-adapter" } });
    expect(allowGpuFor(noGpu, "auto")).toBe(false);
    expect(allowGpuFor(noGpu, "gpu")).toBe(false);
  });
});

describe("planForSnapshot", () => {
  it("keeps the large Whisper when WebGPU can run it", () => {
    expect(planForSnapshot(3, snapshot()).whisper.id).toBe("whisper-large-v3-turbo");
  });

  it("swaps the large Whisper for the small one without WebGPU", () => {
    const noGpu = snapshot({ webgpu: { available: false, adapter: null, reason: "no-adapter" } });
    const plan = planForSnapshot(3, noGpu);
    expect(plan.whisper.id).toBe("whisper-small");
    // O LLM continua o do perfil: a CPU de 14 nucleos le o GGUF, so a
    // transcricao nao pode ficar no modelo grande em uma thread.
    expect(plan.llm.id).toBe("lfm2.5-2.6b-q5");
  });

  it("does not change profiles that already use a CPU-sized Whisper", () => {
    const noGpu = snapshot({ webgpu: { available: false, adapter: null, reason: "unsupported" } });
    expect(planForSnapshot(0, noGpu).whisper.id).toBe("whisper-base");
    expect(planForSnapshot(1, noGpu).whisper.id).toBe("whisper-small");
  });
});

describe("threadsFor", () => {
  it("uses every core or half of them, capped at 32", () => {
    expect(threadsFor("all", 14)).toBe(14);
    expect(threadsFor("half", 14)).toBe(7);
    expect(threadsFor("all", 64)).toBe(32);
    expect(threadsFor("half", 1)).toBe(1);
  });
});
