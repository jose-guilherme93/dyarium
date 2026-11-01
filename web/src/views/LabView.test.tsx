import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { planForTier } from "../lib/browserModels";
import type { ProcessorState } from "../lib/browserProcessor";
import type { HardwareSnapshot } from "../lib/hardware";
import { saveWorkerPlan } from "../lib/workerSetup";
import { LabView } from "./LabView";

const snapshot: HardwareSnapshot = {
  userAgent: "Mozilla/5.0",
  browser: { engine: "firefox", name: "Firefox", version: "157" },
  webgpu: {
    available: true,
    adapter: { description: "AMD Radeon RX 580", vendor: "AMD", architecture: "gcn" },
    reason: "ok",
  },
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
  measuredAt: "2026-10-31T12:00:00.000Z",
};

vi.mock("../lib/hardwareProbe", () => ({
  probeHardware: vi.fn(async () => snapshot),
  buildLabReport: vi.fn(),
}));

const worker = vi.hoisted(() => ({
  state: { current: null as ProcessorState | null },
  startWorker: vi.fn(async (plan: { tier: number }) => plan),
}));

vi.mock("../lib/browserWorker", () => ({
  getWorkerState: () => worker.state.current,
  subscribeWorker: (listener: (state: ProcessorState | null) => void) => {
    listener(worker.state.current);
    return () => undefined;
  },
  startWorker: worker.startWorker,
  stopWorker: vi.fn(async () => undefined),
}));

vi.mock("../lib/workerApi", () => ({
  workerApi: {
    status: vi.fn(async () => ({
      workers: [],
      preferred: false,
      ttl_seconds: 60,
      queue: {},
    })),
  },
}));

function runningState(plan: ReturnType<typeof planForTier>): ProcessorState {
  return {
    phase: "waiting",
    plan,
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
}

beforeEach(() => {
  localStorage.clear();
  worker.state.current = null;
  worker.startWorker.mockClear();
});

describe("LabView", () => {
  it("escolhe o perfil antes de ligar o PC", async () => {
    render(<LabView />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Modelos" })).toBeInTheDocument(),
    );
    const order = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);
    expect(order.indexOf("Modelos")).toBeLessThan(order.indexOf("Neste PC"));
  });

  it("volta com o perfil maximo salvo depois de navegar para outra tela", async () => {
    saveWorkerPlan(planForTier(4));

    render(<LabView />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Máximo" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(screen.getAllByText("Qwen2.5 7B qualidade máxima").length).toBeGreaterThan(0);
  });

  it("reinicia o motor com o novo perfil quando ele troca com o worker ligado", async () => {
    worker.state.current = runningState(planForTier(1));

    render(<LabView />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Máximo" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Máximo" }));

    await waitFor(() => expect(worker.startWorker).toHaveBeenCalled());
    expect(worker.startWorker.mock.calls[0][0].tier).toBe(4);
  });
});
