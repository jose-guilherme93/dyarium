import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planForTier } from "./browserModels";

/**
 * O worker local nao pode puxar a fila por conta propria: ele fica parado
 * enquanto nao existe um pedido explicito do botao Analisar. Este teste olha o
 * contrato com o servidor, nao o motor de inferencia.
 */

const mocks = vi.hoisted(() => ({
  register: vi.fn(async () => ({ worker: {}, ttl_seconds: 60 })),
  claim: vi.fn(async () => ({ job: null as unknown })),
  heartbeat: vi.fn(async () => ({ ok: true, lost: false })),
  status: vi.fn(async () => ({
    workers: [],
    preferred: false,
    ttl_seconds: 60,
    queue: {},
  })),
  complete: vi.fn(async () => ({ ok: true, lost: false })),
  fail: vi.fn(async () => ({ ok: true, lost: false, final: false })),
  release: vi.fn(async () => ({ ok: true, lost: false })),
  unregister: vi.fn(async () => ({ ok: true })),
}));

vi.mock("./workerApi", () => ({
  workerApi: {
    register: mocks.register,
    claim: mocks.claim,
    heartbeat: mocks.heartbeat,
    status: mocks.status,
    complete: mocks.complete,
    fail: mocks.fail,
    release: mocks.release,
    unregister: mocks.unregister,
  },
  fetchEntryBundle: vi.fn(),
  fetchAudio: vi.fn(),
  saveAnalysis: vi.fn(),
  saveTranscript: vi.fn(),
}));

vi.mock("./engineClient", () => ({
  EngineClient: class {
    load = vi.fn(async () => ({ ready: true }));
    dispose(): void {}
    stop(): void {}
    analyze(): never {
      throw new Error("a analise nao deveria rodar neste teste");
    }
    transcribe(): never {
      throw new Error("a transcricao nao deveria rodar neste teste");
    }
  },
}));

import { BrowserProcessor } from "./browserProcessor";

async function boot(): Promise<BrowserProcessor> {
  const processor = new BrowserProcessor(
    { owner_name: "", all_notes_mine: true },
    () => undefined,
  );
  await processor.start(planForTier(0), {});
  return processor;
}

describe("BrowserProcessor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.claim.mockResolvedValue({ job: null });
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("fica ocioso quando o modo liga, sem reservar a fila", async () => {
    const processor = await boot();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(mocks.claim).not.toHaveBeenCalled();
    expect(processor.snapshot.phase).toBe("waiting");
    expect(mocks.register).toHaveBeenLastCalledWith(
      expect.objectContaining({ preferClient: false }),
    );

    await processor.abandon();
  });

  it("processa somente a nota pedida e devolve a fila ao servidor", async () => {
    const processor = await boot();
    await vi.advanceTimersByTimeAsync(1_000);

    const accepted = await processor.beginEntry("entry-1");
    expect(accepted).toBe(true);
    expect(mocks.register).toHaveBeenLastCalledWith(
      expect.objectContaining({ preferClient: true }),
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.claim).toHaveBeenCalledWith(expect.any(String), 120, "entry-1", true);

    // A nota pedida nao entrou na fila: depois de algumas tentativas o worker
    // solta a preferencia para a VPS voltar a andar.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mocks.register).toHaveBeenLastCalledWith(
      expect.objectContaining({ preferClient: false }),
    );
    const calls = mocks.claim.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.claim.mock.calls.length).toBe(calls);

    await processor.abandon();
  });
});
