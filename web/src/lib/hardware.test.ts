import { describe, expect, it } from "vitest";
import {
  chooseTier,
  detectBrowser,
  knownGpuFor,
  vramFromAdapter,
  webGpuLabel,
  type HardwareSnapshot,
} from "./hardware";
import { formatBytes, planDownloadBytes, planForTier } from "./browserModels";
import { wasmSimd } from "./hardwareProbe";

function snapshot(overrides: Partial<HardwareSnapshot> = {}): HardwareSnapshot {
  return {
    userAgent: "Mozilla/5.0",
    browser: { engine: "chromium", name: "Edge", version: "140" },
    webgpu: { available: true, adapter: null, reason: "ok" },
    webgl: { renderer: "", vendor: "" },
    cpu: { threads: 8, gflops: 12 },
    memory: { deviceMemoryGB: 8, heapLimitGB: 4, vramGB: null, vramSource: "unknown" },
    storage: { quotaGB: 100, usageGB: 1 },
    features: {
      wasmSimd: true,
      sharedArrayBuffer: true,
      crossOriginIsolated: false,
      offscreenCanvas: true,
      webCodecs: true,
      audioContext: true,
      opfs: true,
      indexedDB: true,
      wakeLock: true,
    },
    measuredAt: "2026-10-29T12:00:00.000Z",
    ...overrides,
  };
}

describe("detectBrowser", () => {
  it("recognizes Edge before Chrome", () => {
    const info = detectBrowser(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
    );
    expect(info).toEqual({ engine: "chromium", name: "Edge", version: "140.0.0.0" });
  });

  it("recognizes Firefox", () => {
    const info = detectBrowser("Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0");
    expect(info.engine).toBe("firefox");
    expect(info.name).toBe("Firefox");
    expect(info.version).toBe("144.0");
  });
});

describe("knownGpuFor", () => {
  it("finds the RX 580 and its 8 GB", () => {
    const gpu = knownGpuFor(
      snapshot({ webgl: { renderer: "AMD Radeon RX 580 Series", vendor: "AMD" } }),
    );
    expect(gpu?.tier).toBe(3);
    expect(gpu?.vramGB).toBe(8);
  });

  it("treats Intel HD as integrated", () => {
    const gpu = knownGpuFor(
      snapshot({ webgl: { renderer: "Intel(R) HD Graphics 530", vendor: "Intel" } }),
    );
    expect(gpu?.tier).toBe(1);
    expect(gpu?.vramGB).toBe(0);
  });
});

describe("chooseTier", () => {
  it("puts an RX 580 with 16 GB of RAM on tier 3", () => {
    const verdict = chooseTier(
      snapshot({
        webgl: { renderer: "AMD Radeon RX 580 Series", vendor: "AMD" },
        memory: { deviceMemoryGB: 8, heapLimitGB: 16, vramGB: 8, vramSource: "table" },
      }),
    );
    expect(verdict.tier).toBe(3);
    expect(verdict.fullSupport).toBe(true);
  });

  it("keeps a 3 GB GPU at tier 2 and never promises 7B", () => {
    const verdict = chooseTier(
      snapshot({
        webgl: { renderer: "NVIDIA GeForce GTX 1060 3GB", vendor: "NVIDIA" },
        memory: { deviceMemoryGB: 8, heapLimitGB: 8, vramGB: 3, vramSource: "table" },
      }),
    );
    expect(verdict.tier).toBe(2);
    expect(planForTier(verdict.tier).llm.id).not.toContain("7b");
  });

  it("sends 12 GB+ to tier 4", () => {
    const verdict = chooseTier(
      snapshot({
        webgl: { renderer: "NVIDIA GeForce RTX 4070", vendor: "NVIDIA" },
        memory: { deviceMemoryGB: 8, heapLimitGB: 16, vramGB: 12, vramSource: "table" },
      }),
    );
    expect(verdict.tier).toBe(4);
    expect(planForTier(verdict.tier).llm.id).toBe("qwen2.5-7b-q4");
  });

  it("falls back to a light tier without WebGPU", () => {
    const verdict = chooseTier(
      snapshot({
        webgpu: { available: false, adapter: null, reason: "no-adapter" },
        webgl: { renderer: "", vendor: "" },
        cpu: { threads: 2, gflops: 0.4 },
      }),
    );
    expect(verdict.tier).toBe(0);
    expect(verdict.warnings.some((warning) => warning.includes("WebGPU"))).toBe(true);
  });

  it("does not pick a heavy tier on 4 GB of RAM", () => {
    const verdict = chooseTier(
      snapshot({
        webgl: { renderer: "NVIDIA GeForce RTX 3060", vendor: "NVIDIA" },
        memory: { deviceMemoryGB: 4, heapLimitGB: 4, vramGB: 12, vramSource: "table" },
      }),
    );
    expect(verdict.tier).toBeLessThanOrEqual(1);
  });

  it("warns Firefox without WebGPU but keeps full support through WASM", () => {
    const verdict = chooseTier(
      snapshot({
        browser: { engine: "firefox", name: "Firefox", version: "144.0" },
        webgpu: { available: false, adapter: null, reason: "no-adapter" },
        webgl: { renderer: "Intel(R) HD Graphics 620", vendor: "Intel" },
        memory: { deviceMemoryGB: 8, heapLimitGB: 8, vramGB: 0, vramSource: "table" },
      }),
    );
    expect(verdict.tier).toBe(1);
    expect(verdict.fullSupport).toBe(true);
    expect(verdict.warnings.some((warning) => warning.includes("WebAssembly"))).toBe(true);
  });
});

describe("wasmSimd", () => {
  it("validates a real SIMD module instead of a malformed one", () => {
    expect(wasmSimd()).toBe(true);
  });
});

describe("vramFromAdapter", () => {
  it("uses the buffer limit as a floor", () => {
    expect(vramFromAdapter({ maxBufferSize: 512 * 1024 ** 2 })).toBe(2);
    expect(vramFromAdapter(null)).toBeNull();
  });
});

describe("download sizes", () => {
  it("shows the total that the user is about to download", () => {
    const plan = planForTier(3);
    expect(planDownloadBytes(plan)).toBeGreaterThan(2 * 1024 ** 3);
    expect(formatBytes(planDownloadBytes(plan))).toMatch(/GB/);
  });

  it("keeps the 7B tier honest about its size", () => {
    const plan = planForTier(4);
    expect(planDownloadBytes(plan)).toBeGreaterThan(5 * 1024 ** 3);
    expect(plan.llm.note).toContain("12 GB");
  });
});

describe("webGpuLabel", () => {
  it("diz que a WebGPU exige HTTPS em vez de um não seco", () => {
    expect(webGpuLabel(snapshot({ webgpu: { available: false, adapter: null, reason: "insecure" } }))).toBe(
      "não · HTTPS",
    );
  });

  it("separa falta de suporte de falta de adaptador", () => {
    expect(webGpuLabel(snapshot({ webgpu: { available: false, adapter: null, reason: "unsupported" } }))).toBe(
      "não · navegador",
    );
    expect(webGpuLabel(snapshot({ webgpu: { available: false, adapter: null, reason: "no-adapter" } }))).toBe(
      "não · driver",
    );
  });

  it("marca adaptador de software", () => {
    expect(webGpuLabel(snapshot({ webgpu: { available: true, adapter: null, reason: "software" } }))).toBe(
      "software",
    );
  });
});
