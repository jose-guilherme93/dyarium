import { describe, expect, it } from "vitest";
import { gpuLabelFor, loadDeviceIdentity } from "./deviceIdentity";
import type { HardwareSnapshot } from "./hardware";

function snapshot(overrides: Partial<HardwareSnapshot> = {}): HardwareSnapshot {
  return {
    userAgent: "Mozilla/5.0",
    browser: { engine: "chromium", name: "Edge", version: "156.0.0.0" },
    platform: "Windows",
    webgpu: { available: true, adapter: null, reason: "ok" },
    webgl: { renderer: "", vendor: "" },
    cpu: { threads: 4, gflops: null },
    memory: { deviceMemoryGB: 4, heapLimitGB: 4, vramGB: null, vramSource: "unknown" },
    storage: { quotaGB: null, usageGB: null },
    features: {
      wasmSimd: true,
      sharedArrayBuffer: false,
      crossOriginIsolated: false,
      offscreenCanvas: true,
      webCodecs: true,
      audioContext: true,
      opfs: false,
      indexedDB: true,
      wakeLock: true,
    },
    measuredAt: "2026-10-29T12:00:00.000Z",
    ...overrides,
  };
}

describe("deviceIdentity", () => {
  it("limpa o nome do ANGLE e mantém a placa", () => {
    const label = gpuLabelFor(
      snapshot({
        webgl: {
          renderer: "ANGLE (Intel, Mesa Intel(R) HD Graphics 620 (KBL GT2), OpenGL ES 3.2)",
          vendor: "Google Inc.",
        },
      }),
    );
    expect(label).toBe("Intel HD Graphics 620");
  });

  it("monta navegador, sistema e placa em uma linha", () => {
    const device = loadDeviceIdentity(
      snapshot({
        webgl: { renderer: "ANGLE (Intel, Mesa Intel(R) HD Graphics 620 (KBL GT2))", vendor: "" },
      }),
    );
    expect(device.name).toBe("Edge 156 · Windows · Intel HD Graphics 620");
    expect(device.id).toMatch(/^dev-[0-9a-f]{24}$/);
  });

  it("reaproveita o identificador guardado na instalação", () => {
    const first = loadDeviceIdentity(snapshot());
    const second = loadDeviceIdentity(snapshot());
    expect(second.id).toBe(first.id);
  });
});
