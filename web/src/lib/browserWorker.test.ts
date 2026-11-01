import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planForTier, type BrowserPlan } from "./browserModels";
import type { ProcessorState } from "./browserProcessor";

interface FakeProcessor {
  id: string;
  snapshot: ProcessorState;
  startedWith: BrowserPlan | null;
  abandoned: boolean;
  start(plan: BrowserPlan): Promise<void>;
  abandon(): Promise<void>;
  stop(): Promise<void>;
}

const mocks = vi.hoisted(() => ({
  instances: [] as unknown[],
  pending: null as null | { resolve: () => void },
}));

vi.mock("./browserProcessor", () => {
  class BrowserProcessor {
    id = "tab-test";
    startedWith: BrowserPlan | null = null;
    abandoned = false;
    onChange: (state: ProcessorState) => void;
    snapshot = {
      phase: "preparing",
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
    } as ProcessorState;

    constructor(_settings: unknown, onChange: (state: ProcessorState) => void) {
      this.onChange = onChange;
      mocks.instances.push(this);
    }

    async start(plan: BrowserPlan): Promise<void> {
      this.startedWith = plan;
      this.snapshot = { ...this.snapshot, phase: "preparing", plan };
      this.onChange(this.snapshot);
      await new Promise<void>((resolve) => {
        mocks.pending = { resolve: () => resolve() };
      });
      this.snapshot = { ...this.snapshot, phase: "waiting", plan };
      this.onChange(this.snapshot);
    }

    async abandon(): Promise<void> {
      this.abandoned = true;
      mocks.pending?.resolve();
      this.snapshot = { ...this.snapshot, phase: "idle" };
      this.onChange(this.snapshot);
    }

    async stop(): Promise<void> {
      mocks.pending?.resolve();
      this.snapshot = { ...this.snapshot, phase: "idle" };
      this.onChange(this.snapshot);
    }
  }
  return {
    BrowserProcessor,
    loadWorkerSettings: async () => ({ owner_name: "", all_notes_mine: true }),
  };
});

vi.mock("./workerApi", () => ({
  workerApi: {
    unregister: vi.fn(async () => ({ ok: true })),
    unregisterOnExit: vi.fn(),
    register: vi.fn(async () => ({ worker: {}, ttl_seconds: 60 })),
  },
}));

import { startWorker, stopWorker } from "./browserWorker";

function instances(): FakeProcessor[] {
  return mocks.instances as FakeProcessor[];
}

function releaseStart(): void {
  mocks.pending?.resolve();
  mocks.pending = null;
}

beforeEach(() => {
  mocks.instances.length = 0;
  mocks.pending = null;
});

afterEach(async () => {
  releaseStart();
  await stopWorker();
});

describe("startWorker", () => {
  it("reaproveita o motor quando o perfil e o mesmo", async () => {
    const plan = planForTier(1);

    const first = startWorker(plan, {}, true, 2);
    await vi.waitFor(() => expect(instances()).toHaveLength(1));
    releaseStart();
    await first;

    const second = startWorker(plan, {}, true, 2);
    await second;

    expect(instances()).toHaveLength(1);
  });

  it("reinicia o motor quando o perfil muda com o worker ligado", async () => {
    const light = planForTier(1);
    const max = planForTier(4);

    const first = startWorker(light, {}, true, 2);
    await vi.waitFor(() => expect(instances()).toHaveLength(1));
    releaseStart();
    await first;

    const second = startWorker(max, {}, true, 2);
    await vi.waitFor(() => expect(instances()).toHaveLength(2));
    releaseStart();
    await second;

    expect(instances()[0].abandoned).toBe(true);
    expect(instances()[1].startedWith?.llm.id).toBe("qwen2.5-7b-q4");
  });

  it("cancela o download antigo antes de baixar o perfil novo", async () => {
    const light = planForTier(1);
    const max = planForTier(4);

    // O primeiro start fica preso no download, como um perfil leve baixando.
    const first = startWorker(light, {}, true, 2);
    await vi.waitFor(() => expect(instances()).toHaveLength(1));

    const second = startWorker(max, {}, true, 2);
    await vi.waitFor(() => expect(instances()).toHaveLength(2));
    releaseStart();
    await Promise.all([first, second]);

    expect(instances()[0].abandoned).toBe(true);
    expect(instances()[1].startedWith?.llm.id).toBe("qwen2.5-7b-q4");
  });
});
