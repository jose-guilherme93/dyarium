import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O F5 desta aba: o sessionStorage continua, a memoria do modulo nao.
 *
 * Este arquivo existe separado porque `vi.resetModules` recria o grafo de
 * modulos; misturar com os testes de sair da conta daria duas instancias de
 * `driveSession` no mesmo arquivo.
 */
const google = vi.hoisted(() => ({ token: vi.fn() }));
vi.mock("./google", async (importOriginal) => {
  const original = await importOriginal<typeof import("./google")>();
  return { ...original, requestDriveToken: google.token };
});
vi.mock("../lib/idb", () => ({
  storeSet: vi.fn(async () => undefined),
  storeClear: vi.fn(async () => undefined),
}));

import { DRIVE_SESSION_KEY } from "./driveSession";

const SESSAO = (expiresAt: number): string =>
  JSON.stringify({
    accessToken: "tok",
    expiresAt,
    scope: "openid email profile https://www.googleapis.com/auth/drive.file",
  });

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  google.token.mockReset();
  vi.resetModules();
});

describe("sessao do Drive depois do F5", () => {
  it("retoma a sessao guardada sem falar com o Google", async () => {
    sessionStorage.setItem(DRIVE_SESSION_KEY, SESSAO(Date.now() + 3_600_000));

    const { driveClient, driveSessionState } = await import("./driveSession");

    expect(driveSessionState()).toBe("connected");
    expect(driveClient()).not.toBeNull();
    expect(google.token).not.toHaveBeenCalled();
  });

  it("descarta a sessao vencida", async () => {
    sessionStorage.setItem(DRIVE_SESSION_KEY, SESSAO(Date.now() + 30_000));

    const { driveSessionState } = await import("./driveSession");

    expect(driveSessionState()).toBe("off");
    expect(sessionStorage.getItem(DRIVE_SESSION_KEY)).toBeNull();
  });

  it("descarta sessao ilegivel", async () => {
    sessionStorage.setItem(DRIVE_SESSION_KEY, "{quebrado");

    const { driveSessionState } = await import("./driveSession");

    expect(driveSessionState()).toBe("off");
    expect(sessionStorage.getItem(DRIVE_SESSION_KEY)).toBeNull();
  });
});
