import { beforeEach, describe, expect, it, vi } from "vitest";

// O sair de verdade: a sessao do Google responde, o cofre e gravado e o cache
// local so cai depois da confirmacao dos snapshots. O segundo plano do login
// precisa ter terminado antes da limpeza, senao uma capa poderia voltar para o
// IndexedDB depois do usuario sair.
const cloud = vi.hoisted(() => ({
  sync: vi.fn(async () => null),
  written: vi.fn(async () => true),
  background: vi.fn(async () => undefined),
}));

const wipe = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("./driveSession", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./driveSession")>();
  return {
    ...actual,
    driveSessionState: vi.fn(() => "connected" as const),
    driveVaultRoot: vi.fn(async () => ({}) as never),
    disconnectDrive: vi.fn(),
  };
});

vi.mock("./driveMark", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./driveMark")>();
  return { ...actual, clearDriveMark: vi.fn() };
});

vi.mock("./vaultCloud", () => ({
  syncVaultToDrive: () => cloud.sync(),
  vaultSnapshotsWritten: () => cloud.written(),
  waitVaultBackground: () => cloud.background(),
}));

vi.mock("../storage/db", () => ({ wipeLocalVault: () => wipe() }));

import { leaveAccount } from "./signOut";

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  cloud.written.mockResolvedValue(true);
});

describe("sair da conta com o cofre no Drive", () => {
  it("grava, confirma os snapshots e espera o segundo plano antes de apagar", async () => {
    const resultado = await leaveAccount();

    expect(resultado).toEqual({ ok: true });
    expect(cloud.sync).toHaveBeenCalledTimes(1);
    expect(cloud.written).toHaveBeenCalledTimes(1);
    // O cache so e apagado depois do sync, do segundo plano e da confirmacao.
    expect(cloud.sync.mock.invocationCallOrder[0]).toBeLessThan(
      cloud.background.mock.invocationCallOrder[0],
    );
    expect(cloud.background.mock.invocationCallOrder[0]).toBeLessThan(
      cloud.written.mock.invocationCallOrder[0],
    );
    expect(cloud.written.mock.invocationCallOrder[0]).toBeLessThan(
      wipe.mock.invocationCallOrder[0],
    );
  });

  it("sem o snapshot confirmado nao apaga o cache", async () => {
    cloud.written.mockResolvedValue(false);

    const resultado = await leaveAccount();

    expect(resultado).toMatchObject({ ok: false, reason: "save-failed" });
    expect(wipe).not.toHaveBeenCalled();
  });

  it("falha na gravacao tambem segura o cache", async () => {
    cloud.sync.mockRejectedValueOnce(new Error("Drive caiu"));

    const resultado = await leaveAccount();

    expect(resultado).toMatchObject({ ok: false, reason: "save-failed" });
    expect(wipe).not.toHaveBeenCalled();
  });
});
