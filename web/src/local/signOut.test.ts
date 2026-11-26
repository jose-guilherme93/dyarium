import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { disconnectDrive } from "./driveSession";


beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  cloud.written.mockResolvedValue(true);
});

describe("sair da conta", () => {
  it("grava antes de desconectar e limpa o cache", async () => {
    await leaveAccount();
    expect(cloud.sync).toHaveBeenCalledTimes(1);
    expect(disconnectDrive).toHaveBeenCalled();
    expect(wipe).toHaveBeenCalled();
  });

  it("falha na gravacao nao impede desconectar/wipe", async () => {
    cloud.sync.mockRejectedValueOnce(new Error("Drive caiu"));
    await expect(leaveAccount()).resolves.toBeUndefined();
    expect(disconnectDrive).toHaveBeenCalled();
    expect(wipe).toHaveBeenCalled();
  });

  it("falha no wipe nao impede a saida", async () => {
    wipe.mockRejectedValueOnce(new Error("wipe falhou"));
    await expect(leaveAccount()).resolves.toBeUndefined();
    expect(disconnectDrive).toHaveBeenCalled();
  });
});
