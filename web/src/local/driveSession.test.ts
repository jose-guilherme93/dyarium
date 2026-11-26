import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O token do Drive so pode viver na memoria do modulo `driveSession`: qualquer
// gravacao em localStorage ou no IndexedDB falha este teste.
const idb = vi.hoisted(() => ({
  storeSet: vi.fn(async () => undefined),
  storeClear: vi.fn(async () => undefined),
}));
vi.mock("../lib/idb", () => idb);

// O login do Google abre a janela do GIS: aqui ele devolve um token de mentira.
const google = vi.hoisted(() => ({ token: vi.fn(), start: vi.fn() }));
vi.mock("./google", async (importOriginal) => {
  const original = await importOriginal<typeof import("./google")>();
  return {
    ...original,
    requestDriveToken: (options?: { silent?: boolean; prompt?: string }) => google.token(options),
    startDriveLogin: () => google.start(),
  };
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
  tokenTemIdentidade,
  DRIVE_SESSION_KEY,
} from "./driveSession";
import { cachedProfile } from "./account";
import { driveMarked, rememberDriveVault } from "./driveMark";
import { removeWebDatabaseFiles, wipeLocalVault } from "../storage/db";

const setItem = vi.spyOn(Storage.prototype, "setItem");

const FOLDER_MIME = "application/vnd.google-apps.folder";
/** Escopos completos: identidade e Drive no mesmo consentimento. */
const SCOPE = "openid email profile https://www.googleapis.com/auth/drive.file";
/** Resposta real do Google: identidade vem como URL de userinfo. */
const SCOPE_URL =
  "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/drive.file";

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
  sessionStorage.clear();
  google.token.mockReset();
  google.start.mockReset();
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

  it("connect guarda a sessao na aba, nunca no localStorage", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "client-id-de-teste");
    google.token.mockResolvedValue({ accessToken: "tok", expiresAt: Date.now() + 3_600_000, scope: SCOPE });

    const avisos: string[] = [];
    const sair = onDriveSessionChange(() => avisos.push(driveSessionState()));

    const client = await connectDrive();

    expect(driveConfigured()).toBe(true);
    expect(client).toBeInstanceOf(DriveClient);
    expect(driveClient()).toBe(client);
    expect(driveSessionState()).toBe("connected");
    expect(avisos).toEqual(["connected"]);
    // A sessao desta aba sobrevive ao F5, mas nunca vai para o localStorage
    // nem para o IndexedDB.
    const guardado = JSON.parse(sessionStorage.getItem(DRIVE_SESSION_KEY) ?? "null");
    expect(guardado).toMatchObject({ accessToken: "tok", scope: SCOPE });
    expect(localStorage.getItem(DRIVE_SESSION_KEY)).toBeNull();
    expect(idb.storeSet).not.toHaveBeenCalled();
    sair();
  });

  it("token perto de vencer vira expired, some do cliente e avisa uma vez", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "client-id-de-teste");
    google.token.mockResolvedValue({ accessToken: "tok", expiresAt: Date.now() + 30_000, scope: SCOPE });
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
    google.token.mockResolvedValue({ accessToken: "tok", expiresAt: Date.now() + 3_600_000, scope: SCOPE });
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
    google.token.mockResolvedValue({ accessToken: "tok", expiresAt: Date.now() + 3_600_000, scope: SCOPE });
    await connectDrive();

    const avisos = vi.fn();
    const sair = onDriveSessionChange(avisos);

    disconnectDrive();

    expect(driveSessionState()).toBe("off");
    expect(driveClient()).toBeNull();
    expect(avisos).toHaveBeenCalledTimes(1);
    sair();
  });

  it("disconnect apaga a sessao guardada", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "client-id-de-teste");
    google.token.mockResolvedValue({ accessToken: "tok", expiresAt: Date.now() + 3_600_000, scope: SCOPE });
    await connectDrive();
    expect(sessionStorage.getItem(DRIVE_SESSION_KEY)).not.toBeNull();

    disconnectDrive();

    expect(sessionStorage.getItem(DRIVE_SESSION_KEY)).toBeNull();
  });

  it("expoe o perfil vindo do userinfo e o guarda no cache", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "client-id-de-teste");
    google.token.mockResolvedValue({ accessToken: "tok", expiresAt: Date.now() + 3_600_000, scope: SCOPE });
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

  it("o pedido silencioso chega ao Google sem tela de login", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "client-id-de-teste");
    google.token.mockResolvedValue({ accessToken: "tok", expiresAt: Date.now() + 3_600_000, scope: SCOPE });

    await connectDrive({ silent: true });

    expect(google.token).toHaveBeenCalledWith({ silent: true });
  });

  it("login interativo sem identidade nao abre uma segunda janela", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "client-id-de-teste");
    google.token.mockResolvedValueOnce({
      accessToken: "tok-drive",
      expiresAt: Date.now() + 3_600_000,
      scope: "openid https://www.googleapis.com/auth/drive.file",
    });
    // Uma segunda chamada abriria outra janela fora do gesto do usuario; o
    // Chrome bloqueia e a tela fica presa em "entrando com o Google".
    google.token.mockResolvedValue({
      accessToken: "tok-identidade",
      expiresAt: Date.now() + 3_600_000,
      scope: SCOPE,
    });

    const client = await connectDrive();

    expect(client).toBeInstanceOf(DriveClient);
    expect(google.token).toHaveBeenCalledTimes(1);
    expect(driveClient()).toBe(client);
  });

  it("busca a identidade pelo userinfo mesmo sem scope no token", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "client-id-de-teste");
    google.token.mockResolvedValue({
      accessToken: "tok",
      expiresAt: Date.now() + 3_600_000,
      scope: undefined,
    });
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

    expect(google.token).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(cachedProfile()).toEqual(perfil));
  });

  it("token com email/profile nao pede consentimento de novo", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "client-id-de-teste");
    google.token.mockResolvedValue({
      accessToken: "tok",
      expiresAt: Date.now() + 3_600_000,
      scope: SCOPE,
    });
    const perfil = { name: "Ada", email: "ada@example.com", picture: "" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes("/userinfo")
          ? new Response(JSON.stringify(perfil), { status: 200 })
          : new Response("", { status: 500 }),
      ) as unknown as typeof fetch,
    );

    await connectDrive();

    expect(google.token).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(cachedProfile()).toEqual(perfil));
  });

  it("reconhece email/profile tanto pelo nome curto quanto pela URL do userinfo", () => {
    expect(tokenTemIdentidade(SCOPE)).toBe(true);
    expect(tokenTemIdentidade(SCOPE_URL)).toBe(true);
    expect(
      tokenTemIdentidade(
        "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.file",
      ),
    ).toBe(false);
    expect(
      tokenTemIdentidade(
        "openid https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/drive.file",
      ),
    ).toBe(false);
    expect(tokenTemIdentidade("openid https://www.googleapis.com/auth/drive.file")).toBe(false);
    expect(tokenTemIdentidade(undefined)).toBe(false);
  });

  it("token com identidade em URL nao pede consentimento", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "client-id-de-teste");
    google.token.mockResolvedValue({
      accessToken: "tok",
      expiresAt: Date.now() + 3_600_000,
      scope: SCOPE_URL,
    });
    const perfil = { name: "Ada", email: "ada@example.com", picture: "" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes("/userinfo")
          ? new Response(JSON.stringify(perfil), { status: 200 })
          : new Response("", { status: 500 }),
      ) as unknown as typeof fetch,
    );

    await connectDrive();

    expect(google.token).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(cachedProfile()).toEqual(perfil));
  });

  it("nao abre segunda janela quando o token traz so parte da identidade", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "client-id-de-teste");
    google.token.mockResolvedValue({
      accessToken: "tok-sem-profile",
      expiresAt: Date.now() + 3_600_000,
      scope:
        "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.file",
    });

    await connectDrive();

    expect(google.token).toHaveBeenCalledTimes(1);
  });

  it("pedido silencioso sem email/profile nao abre tela de consentimento", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "client-id-de-teste");
    google.token.mockResolvedValue({
      accessToken: "tok",
      expiresAt: Date.now() + 3_600_000,
      scope: "openid https://www.googleapis.com/auth/drive.file",
    });

    await connectDrive({ silent: true });

    expect(google.token).toHaveBeenCalledTimes(1);
    expect(google.token).toHaveBeenCalledWith({ silent: true });
  });

  it("login interativo com redirect nao abre janela do Google", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "client-id-de-teste");

    void connectDrive({ redirect: true });
    await Promise.resolve();

    expect(google.start).toHaveBeenCalledTimes(1);
    expect(google.token).not.toHaveBeenCalled();
  });

  it("depois do redirect, o token que ja esta na sessao abre o cofre sem pedir de novo", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "client-id-de-teste");
    google.token.mockResolvedValue({
      accessToken: "tok",
      expiresAt: Date.now() + 3_600_000,
      scope: SCOPE,
    });
    // Primeira sessao (equivale ao token que o retorno do redirect aplicou).
    await connectDrive();
    google.start.mockClear();
    google.token.mockClear();

    const client = await connectDrive({ redirect: true });

    expect(client).toBeInstanceOf(DriveClient);
    expect(google.start).not.toHaveBeenCalled();
    expect(google.token).not.toHaveBeenCalled();
  });
});

describe("sair da conta", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "client-id-de-teste");
    google.token.mockResolvedValue({
      accessToken: "tok",
      expiresAt: Date.now() + 3_600_000,
      scope: SCOPE,
    });
  });

  it("grava e confirma o pendente antes de apagar o cache", async () => {
    const save = vi.fn(async () => true);
    const wipe = vi.fn(async () => undefined);
    localStorage.setItem("dyarium.onboarded", "1");
    rememberDriveVault();
    await connectDrive();

    const resultado = await signOutAccount({ save, hasPending: () => true, wipe });

    expect(resultado).toEqual({ ok: true });
    expect(save).toHaveBeenCalledTimes(1);
    expect(wipe).toHaveBeenCalledTimes(1);
    expect(driveSessionState()).toBe("off");
    expect(driveProfile()).toBeNull();
    expect(cachedProfile()).toBeNull();
    expect(driveMarked()).toBe(false);
    // O proximo carregamento abre o cofre local vazio, sem a primeira tela.
    expect(localStorage.getItem("dyarium.onboarded")).toBe("1");
  });

  it("sair nao revoga o token no Google", async () => {
    const save = vi.fn(async () => true);
    const wipe = vi.fn(async () => undefined);
    rememberDriveVault();
    await connectDrive();

    await signOutAccount({ save, wipe });

    const pedidos = vi.mocked(globalThis.fetch).mock.calls.map(([url]) => String(url));
    expect(pedidos.some((url) => url.includes("/revoke"))).toBe(false);
  });

  it("falha ao apagar o cache vira wipe-failed e nao encerra a sessao", async () => {
    const save = vi.fn(async () => true);
    const wipe = vi.fn(async () => {
      throw new Error("OPFS falhou");
    });
    rememberDriveVault();
    await connectDrive();

    const resultado = await signOutAccount({ save, wipe });

    expect(resultado).toMatchObject({ ok: false, reason: "wipe-failed" });
    expect(driveSessionState()).toBe("connected");
    expect(driveMarked()).toBe(true);
  });

  it("falha ao gravar nao apaga o cache nem encerra a sessao", async () => {
    const wipe = vi.fn(async () => undefined);
    const save = vi.fn(async () => {
      throw new Error("sem rede");
    });
    rememberDriveVault();
    await connectDrive();

    const resultado = await signOutAccount({ save, wipe });

    expect(resultado).toMatchObject({ ok: false, reason: "save-failed" });
    expect(wipe).not.toHaveBeenCalled();
    expect(driveSessionState()).toBe("connected");
    expect(driveMarked()).toBe(true);
  });

  it("snapshot nao confirmado tambem bloqueia a saida", async () => {
    const wipe = vi.fn(async () => undefined);
    const save = vi.fn(async () => false);
    rememberDriveVault();
    await connectDrive();

    const resultado = await signOutAccount({ save, wipe });

    expect(resultado).toMatchObject({ ok: false, reason: "save-failed" });
    expect(wipe).not.toHaveBeenCalled();
    expect(driveSessionState()).toBe("connected");
  });

  it("sem sessao e com pendencia nao apaga nada", async () => {
    const wipe = vi.fn(async () => undefined);
    rememberDriveVault();
    await connectDrive();
    disconnectDrive();

    const resultado = await signOutAccount({ hasPending: () => true, wipe });

    expect(resultado).toMatchObject({ ok: false, reason: "pending" });
    expect(wipe).not.toHaveBeenCalled();
    expect(driveMarked()).toBe(true);
  });

  it("sair descartando apaga o cache sem tentar gravar", async () => {
    const save = vi.fn(async () => {
      throw new Error("sem rede");
    });
    const wipe = vi.fn(async () => undefined);
    rememberDriveVault();
    await connectDrive();

    const resultado = await signOutAccount({ discard: true, save, wipe });

    expect(resultado).toEqual({ ok: true });
    expect(save).not.toHaveBeenCalled();
    expect(wipe).toHaveBeenCalledTimes(1);
    expect(driveSessionState()).toBe("off");
    expect(driveMarked()).toBe(false);
  });
});

describe("wipeLocalVault", () => {
  it("fecha o banco, remove os arquivos e limpa o IndexedDB, nessa ordem", async () => {
    const ordem: string[] = [];
    await wipeLocalVault({
      closeDatabase: () => {
        ordem.push("fechar");
      },
      removeDatabaseFiles: async () => {
        ordem.push("remover");
      },
      clearIndexedDb: async () => {
        ordem.push("limpar");
      },
    });
    expect(ordem).toEqual(["fechar", "remover", "limpar"]);
  });
});

describe("removeWebDatabaseFiles", () => {
  it("NotFoundError no diretorio do OPFS significa nada a apagar", async () => {
    const removeEntry = vi.fn(async () => {
      throw Object.assign(new Error("sumiu"), { name: "NotFoundError" });
    });

    await expect(
      removeWebDatabaseFiles({ getDirectory: async () => ({ removeEntry }) }),
    ).resolves.toBeUndefined();
    expect(removeEntry).toHaveBeenCalledWith("dyarium", { recursive: true });
  });

  it("erro real ao remover o OPFS propaga em vez de sumir", async () => {
    const removeEntry = vi.fn(async () => {
      throw new Error("disco falhou");
    });

    await expect(
      removeWebDatabaseFiles({ getDirectory: async () => ({ removeEntry }) }),
    ).rejects.toThrow("disco falhou");
  });
});
