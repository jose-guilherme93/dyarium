import { afterEach, describe, expect, it, vi } from "vitest";
import { api, cachedGet } from "./api";

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
});
