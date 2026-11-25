import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O token do Drive so pode viver na memoria do modulo `driveSession`: qualquer
// gravacao em localStorage ou no IndexedDB falha este teste.
const idb = vi.hoisted(() => ({ storeSet: vi.fn(async () => undefined) }));
vi.mock("../lib/idb", () => idb);

// O login do Google abre a janela do GIS: aqui ele devolve um token de mentira.
const google = vi.hoisted(() => ({ token: vi.fn() }));
vi.mock("./google", async (importOriginal) => {
  const original = await importOriginal<typeof import("./google")>();
  return { ...original, requestDriveToken: (options?: { silent?: boolean }) => google.token(options) };
});

import { DriveClient } from "./drive";
import { DriveFolder } from "./driveFolder";
import {
  connectDrive,
  disconnectDrive,
  driveClient,
  driveConfigured,
  driveProfile,
  driveSessionState,
  driveVaultRoot,
  onDriveSessionChange,
  signOutAccount,
} from "./driveSession";
import { cachedProfile } from "./account";
import { driveMarked, rememberDriveVault } from "./driveMark";

const setItem = vi.spyOn(Storage.prototype, "setItem");

const FOLDER_MIME = "application/vnd.google-apps.folder";

function fakeDrive() {
  const arquivos = new Map<string, { id: string; name: string; parent: string; mimeType: string }>();
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/files")) {
      const q = url.searchParams.get("q") ?? "";
      const nome = /name = '([^']*)'/.exec(q)?.[1];
      const pai = /'([^']+)' in parents/.exec(q)?.[1];
      const lista = [...arquivos.values()].filter(
        (arquivo) => (!nome || arquivo.name === nome) && (!pai || arquivo.parent === pai),
      );
      return new Response(JSON.stringify({ files: lista }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("rota nao prevista no teste", { status: 500 });
  });
  return { arquivos, fetchImpl };
}

beforeEach(() => {
  disconnectDrive();
  google.token.mockReset();
  idb.storeSet.mockClear();
  setItem.mockClear();
  // O userinfo nunca vai a rede num teste: sem perfil, o login segue.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status: 401 })) as unknown as typeof fetch,
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  disconnectDrive();
});

describe("sessao do Drive", () => {
  it("sem VITE_GOOGLE_CLIENT_ID o Drive nao esta configurado", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "");

    expect(driveConfigured()).toBe(false);
    expect(driveClient()).toBeNull();
    expect(driveSessionState()).toBe("off");
    await expect(driveVaultRoot()).rejects.toThrow(/Drive nao conectado/);
    expect(google.token).not.toHaveBeenCalled();
  });

  it("connect guarda o token apenas em memoria", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "client-id-de-teste");
    google.token.mockResolvedValue({ accessToken: "tok", expiresAt: Date.now() + 3_600_000 });

    const avisos: string[] = [];
    const sair = onDriveSessionChange(() => avisos.push(driveSessionState()));

    const client = await connectDrive();

    expect(driveConfigured()).toBe(true);
    expect(client).toBeInstanceOf(DriveClient);
    expect(driveClient()).toBe(client);
    expect(driveSessionState()).toBe("connected");
    expect(avisos).toEqual(["connected"]);
    expect(setItem).not.toHaveBeenCalled();
    expect(idb.storeSet).not.toHaveBeenCalled();
    sair();
  });

  it("token perto de vencer vira expired, some do cliente e avisa uma vez", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "client-id-de-teste");
    google.token.mockResolvedValue({ accessToken: "tok", expiresAt: Date.now() + 30_000 });
    const avisos = vi.fn();
    const sair = onDriveSessionChange(avisos);

    await connectDrive();
    avisos.mockClear();

    expect(driveSessionState()).toBe("expired");
    expect(driveClient()).toBeNull();
    // O aviso sai depois da leitura, para nao notificar no meio do render.
    await Promise.resolve();
    expect(avisos).toHaveBeenCalledTimes(1);
    await expect(driveVaultRoot()).rejects.toThrow(/Drive nao conectado/);

    sair();
  });

  it("a raiz do cofre e a pasta Dyarium na raiz do Drive", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "client-id-de-teste");
    google.token.mockResolvedValue({ accessToken: "tok", expiresAt: Date.now() + 3_600_000 });
    const drive = fakeDrive();
    drive.arquivos.set("pasta-dyarium", {
      id: "pasta-dyarium",
      name: "Dyarium",
      parent: "root",
      mimeType: FOLDER_MIME,
    });
    vi.stubGlobal("fetch", drive.fetchImpl as unknown as typeof fetch);

    await connectDrive();
    const raiz = await driveVaultRoot();

    expect(raiz).toBeInstanceOf(DriveFolder);
    expect(raiz.name).toBe("Dyarium");
    const chamadaDyarium = drive.fetchImpl.mock.calls.find(([input]) => {
      try {
        return new URL(String(input)).searchParams.get("q")?.includes("name = 'Dyarium'") ?? false;
      } catch {
        return false;
      }
    });
    expect(chamadaDyarium).toBeDefined();
    const url = new URL(String(chamadaDyarium![0]));
    const consulta = url.searchParams.get("q") ?? "";
    expect(consulta).toContain("name = 'Dyarium'");
    expect(consulta).toContain("'root' in parents");
  });

  it("disconnect limpa a sessao e avisa quem escuta", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "client-id-de-teste");
    google.token.mockResolvedValue({ accessToken: "tok", expiresAt: Date.now() + 3_600_000 });
    await connectDrive();

    const avisos = vi.fn();
    const sair = onDriveSessionChange(avisos);

    disconnectDrive();

    expect(driveSessionState()).toBe("off");
    expect(driveClient()).toBeNull();
    expect(avisos).toHaveBeenCalledTimes(1);
    sair();
  });

  it("expoe o perfil vindo do userinfo e o guarda no cache", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "client-id-de-teste");
    google.token.mockResolvedValue({ accessToken: "tok", expiresAt: Date.now() + 3_600_000 });
    const perfil = { name: "Ada", email: "ada@example.com", picture: "https://x/p.png" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes("/userinfo")
          ? new Response(JSON.stringify(perfil), { status: 200 })
          : new Response("", { status: 500 }),
      ) as unknown as typeof fetch,
    );

    await connectDrive();
    // A identidade chega depois: o login nao espera a rede de identidade.
    await vi.waitFor(() => expect(driveProfile()).toEqual(perfil));
    expect(cachedProfile()).toEqual(perfil);
  });

  it("sair apaga perfil, cache e a marca do cofre no Drive", async () => {    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "client-id-de-teste");
    google.token.mockResolvedValue({ accessToken: "tok", expiresAt: Date.now() + 3_600_000 });
    const perfil = { name: "Ada", email: "ada@example.com", picture: "" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes("/userinfo")
          ? new Response(JSON.stringify(perfil), { status: 200 })
          : new Response("", { status: 500 }),
      ) as unknown as typeof fetch,
    );
    rememberDriveVault();
    await connectDrive();
    await vi.waitFor(() => expect(cachedProfile()).toEqual(perfil));

    signOutAccount();

    expect(driveSessionState()).toBe("off");
    expect(driveProfile()).toBeNull();
    expect(cachedProfile()).toBeNull();
    expect(driveMarked()).toBe(false);
  });

  it("o pedido silencioso chega ao Google sem tela de login", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "client-id-de-teste");
    google.token.mockResolvedValue({ accessToken: "tok", expiresAt: Date.now() + 3_600_000 });

    await connectDrive({ silent: true });

    expect(google.token).toHaveBeenCalledWith({ silent: true });
  });
});
