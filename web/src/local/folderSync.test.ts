import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import {
  flushVaultSync,
  isVaultDirty,
  lastSyncSummary,
  markVaultDirty,
  runVaultSync,
  setVaultTarget,
} from "./folderSync";

beforeEach(() => {
  vi.useFakeTimers();
  setVaultTarget(null);
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

afterEach(() => {
  setVaultTarget(null);
  vi.useRealTimers();
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

  it("flushVaultSync grava na hora o que estava sujo e limpa o timer", async () => {
    plano.mockResolvedValueOnce({
      manifest: {},
      writes: [{ path: "notes/a.md.enc", bytes: new Uint8Array() }],
      deletes: [],
      unchanged: 0,
    } as never);
    markVaultDirty();
    expect(isVaultDirty()).toBe(true);

    const resultado = await flushVaultSync();

    expect(plano).toHaveBeenCalledTimes(1);
    expect(gravar).toHaveBeenCalledTimes(1);
    expect(resultado).toMatchObject({ written: 1 });
    expect(isVaultDirty()).toBe(false);

    // O timer de dois minutos foi cancelado: nada roda de novo depois.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(plano).toHaveBeenCalledTimes(1);
    expect(gravar).toHaveBeenCalledTimes(1);
  });

  it("duas chamadas de flush compartilham a mesma escrita", async () => {
    plano.mockResolvedValueOnce({
      manifest: {},
      writes: [{ path: "notes/a.md.enc", bytes: new Uint8Array() }],
      deletes: [],
      unchanged: 0,
    } as never);

    const [primeiro, segundo] = await Promise.all([flushVaultSync(), flushVaultSync()]);

    expect(plano).toHaveBeenCalledTimes(1);
    expect(gravar).toHaveBeenCalledTimes(1);
    expect(primeiro).toBe(segundo);
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

  it("usa o alvo configurado quando nenhuma pasta e passada", async () => {
    const drive = { name: "Dyarium no Drive" };
    setVaultTarget(async () => drive as never);
    plano.mockResolvedValueOnce({
      manifest: {},
      writes: [{ path: "notes/a.md.enc", bytes: new Uint8Array() }],
      deletes: [],
      unchanged: 1,
    } as never);

    const resultado = await runVaultSync();

    expect(resultado).toMatchObject({ written: 1, unchanged: 1 });
    expect(gravar).toHaveBeenCalledTimes(1);
    // Com alvo configurado, a pasta lembrada do File System Access nao entra.
    expect(remember).not.toHaveBeenCalled();
  });

  it("pasta explicita vence o alvo configurado", async () => {
    setVaultTarget(async () => null);

    await runVaultSync(pasta);

    expect(plano).toHaveBeenCalledTimes(1);
  });

  it("alvo nulo devolve null sem sujar o cofre", async () => {
    setVaultTarget(async () => null);

    expect(await runVaultSync()).toBeNull();
    expect(plano).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(plano).not.toHaveBeenCalled();
  });

  it("flush com provider nulo limpa a sujeira e nao repete para sempre", async () => {
    setVaultTarget(async () => null);
    markVaultDirty();
    expect(isVaultDirty()).toBe(true);

    expect(await flushVaultSync()).toBeNull();

    // Sem sessao nao ha destino: a sujeira some para o proximo refresh nao
    // reagendar uma escrita que nunca teria para onde ir.
    expect(isVaultDirty()).toBe(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(plano).not.toHaveBeenCalled();
  });

  it("alvo que lanca devolve null sem reagendar", async () => {
    setVaultTarget(async () => {
      throw new Error("Drive nao conectado");
    });

    expect(await runVaultSync()).toBeNull();
    expect(plano).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(plano).not.toHaveBeenCalled();
  });
});
