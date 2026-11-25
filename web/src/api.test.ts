import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, cachedGet, clearToken, getToken, setToken } from "./api";
import * as graphLocal from "./local/graphLocal";
import type { GraphResponse } from "./types";

vi.mock("./local/graphLocal", () => ({
  buildLocalGraph: vi.fn(),
  buildLocalEntityDetail: vi.fn(),
  buildLocalEntityMentions: vi.fn(),
}));

describe("token sem storage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearToken();
  });

  it("entra na sessao mesmo quando o navegador bloqueia localStorage", () => {
    clearToken();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("NS_ERROR_FAILURE");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("NS_ERROR_FAILURE");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("NS_ERROR_FAILURE");
    });

    expect(() => setToken("token-de-teste")).not.toThrow();
    expect(getToken()).toBe("token-de-teste");
    expect(() => clearToken()).not.toThrow();
    expect(getToken()).toBe("");
  });
});

describe("GET cache", () => {
  // Com token o `api` fala com o servidor; sem token ele roteia para o cofre
  // local e nao haveria HTTP para medir.
  beforeEach(() => setToken("token-de-teste"));

  afterEach(() => {
    // Sem `clearToken()`: ele limpa o cache HTTP, e um teste deste bloco
    // depende da copia guardada pelo anterior.
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("revalida com If-None-Match e reusa a copia no 304", async () => {
    const body = { id: "e-cache-1", title: "Nota", audios: [], versions: {} };
    const fetchMock = vi
      .fn()
      // Primeira leitura: corpo novo + ETag.
      .mockResolvedValueOnce(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json", ETag: '"v1"' },
        }),
      )
      // Segunda leitura: o servidor confirma que nada mudou.
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await api.getEntry("e-cache-1");
    expect(first.title).toBe("Nota");
    const second = await api.getEntry("e-cache-1");
    expect(second.title).toBe("Nota");

    const secondInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect((secondInit.headers as Record<string, string>)["If-None-Match"]).toBe('"v1"');
  });

  it("tenta de novo quando o proxy responde 502", async () => {
    vi.useFakeTimers();
    const body = { id: "e-retry-1", title: "Nota", audios: [], versions: {} };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("bad gateway", { status: 502, statusText: "Bad Gateway" }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const pending = api.getEntry("e-retry-1");
    await vi.advanceTimersByTimeAsync(700);
    const entry = await pending;
    expect(entry.title).toBe("Nota");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("cachedGet devolve a ultima copia sem tocar na rede", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const cached = await cachedGet<{ id: string }>("/entries/e-cache-1");
    expect(cached?.id).toBe("e-cache-1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("createImportEntry distingue entrada nova (201) de existente (200)", async () => {    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "e-import-1", title: "Nota" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "e-import-1", title: "Nota" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const first = await api.createImportEntry({
      id: "e-import-1",
      title: "Nota",
      recordedAt: "2025-11-17T18:57:00.000Z",
    });
    const second = await api.createImportEntry({ id: "e-import-1", title: "Nota" });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toMatchObject({
      id: "e-import-1",
      title: "Nota",
      recorded_at: "2025-11-17T18:57:00.000Z",
    });
    expect(body).not.toHaveProperty("created_at");
  });

  it("nao transforma erro HTML do proxy em SyntaxError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>bad gateway</html>", { status: 503, statusText: "Service Unavailable" })),
    );

    const failure = api.deleteEntry("e1");
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ status: 503 });
  });
});

describe("VITE_LOCAL_ONLY na camada de dados", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    clearToken();
  });

  it("com a flag ligada, o token guardado nao manda a interface para o servidor", async () => {
    // O bug que isso cobre: a tela mostrava as 400 notas do servidor, mas o
    // cofre do Drive era montado do banco local vazio e subia "0 gravadas".
    vi.stubEnv("VITE_LOCAL_ONLY", "1");
    setToken("token-de-teste");
    const { isLocalMode } = await import("./api");
    expect(isLocalMode()).toBe(true);
  });

  it("sem a flag, o token guardado continua valendo", async () => {
    vi.stubEnv("VITE_LOCAL_ONLY", "");
    setToken("token-de-teste");
    const { isLocalMode } = await import("./api");
    expect(isLocalMode()).toBe(false);
  });
});

describe("grafo do cofre no modo local", () => {
  afterEach(() => clearToken());

  it("api.getGraph devolve o grafo do builder em vez de falhar sem servidor", async () => {
    clearToken();
    const graph: GraphResponse = {
      center: { id: "user", kind: "user", label: "Você", mentions: 0, notes: 0 },
      nodes: [{ id: "person:marina", kind: "person", label: "Marina", mentions: 2, notes: 2 }],
      edges: [{ source: "user", target: "person:marina", kind: "relation", weight: 2 }],
      total_nodes: 1,
      total_edges: 1,
      truncated: false,
    };
    vi.mocked(graphLocal.buildLocalGraph).mockResolvedValueOnce(graph);

    const result = await api.getGraph({
      notebookId: "n1",
      from: "2026-01-01T00:00:00Z",
      excludeBooks: true,
    });

    expect(result).toBe(graph);
    expect(graphLocal.buildLocalGraph).toHaveBeenCalledWith({
      notebookId: "n1",
      period: "2026-01-01T00:00:00Z",
      focus: undefined,
      excludeBooks: true,
    });
  });
});
