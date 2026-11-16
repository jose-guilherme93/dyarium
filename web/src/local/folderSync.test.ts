import { beforeEach, describe, expect, it, vi } from "vitest";

const pasta = { name: "Dyarium" } as never;
const remember = vi.fn();
const plano = vi.fn();
const gravar = vi.fn();
const lerManifest = vi.fn();

vi.mock("./folder", () => ({ rememberFolder: () => remember() }));
vi.mock("./vaultLayout", () => ({
  planVaultLayout: (previous?: unknown) => plano(previous as never),
  writeVaultLayout: () => gravar(),
  readVaultManifest: () => lerManifest(),
}));

import { lastSyncSummary, markVaultDirty, runVaultSync } from "./folderSync";

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  remember.mockReset();
  plano.mockReset();
  gravar.mockReset();
  lerManifest.mockReset();
  remember.mockResolvedValue(pasta);
  plano.mockResolvedValue({ manifest: {}, writes: [], deletes: [], unchanged: 0 });
  gravar.mockResolvedValue(undefined);
  lerManifest.mockResolvedValue(null);
});

describe("backup automatico na pasta", () => {
  it("espera dois minutos de silencio antes de gravar", async () => {
    markVaultDirty();
    markVaultDirty();
    await vi.advanceTimersByTimeAsync(119_000);
    expect(plano).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(plano).toHaveBeenCalledTimes(1);
    expect(gravar).not.toHaveBeenCalled();
  });

  it("sem pasta lembrada nao faz nada", async () => {
    remember.mockResolvedValueOnce(null);
    const resultado = await runVaultSync();
    expect(resultado).toBeNull();
    expect(plano).not.toHaveBeenCalled();
  });

  it("grava o que mudou e guarda o resumo", async () => {
    plano.mockResolvedValueOnce({
      manifest: {},
      writes: [{ path: "notes/a.md.enc", bytes: new Uint8Array() }],
      deletes: ["notes/velha.md.enc"],
      unchanged: 3,
    } as never);

    const resultado = await runVaultSync(pasta);
    expect(gravar).toHaveBeenCalledTimes(1);
    expect(resultado).toMatchObject({ written: 1, deleted: 1, unchanged: 3 });
    expect(lastSyncSummary()?.written).toBe(1);
  });

  it("erro mantem o cofre sujo e tenta de novo", async () => {
    gravar.mockRejectedValueOnce(new Error("pasta sem permissao"));
    plano.mockResolvedValueOnce({
      manifest: {},
      writes: [{ path: "notes/a.md.enc", bytes: new Uint8Array() }],
      deletes: [],
      unchanged: 0,
    } as never);

    await expect(runVaultSync(pasta)).rejects.toThrow("permissao");
    const chamadas = plano.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(plano.mock.calls.length).toBeGreaterThan(chamadas);
  });
});
