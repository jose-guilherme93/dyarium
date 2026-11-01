import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, cachedGet, clearToken, getToken, setToken } from "./api";

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
  afterEach(() => {
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
