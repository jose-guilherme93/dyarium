import { afterEach, describe, expect, it, vi } from "vitest";
import { saveAnalysis } from "./workerApi";

describe("saveAnalysis", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("assina a analise do navegador com o aparelho que processou", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify({ stored: true, origin: "browser" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await saveAnalysis(
      "e1",
      { model: "lfm2.5-230m-q5", summary: "Resumo." },
      true,
      { id: "dev-abc", name: "Edge 156 · Windows · Intel HD Graphics 620" },
    );

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "lfm2.5-230m-q5",
      replace: true,
      device_id: "dev-abc",
      device_name: "Edge 156 · Windows · Intel HD Graphics 620",
    });
  });

  it("nao manda aparelho quando a analise nao veio do navegador", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify({ stored: true, origin: "app" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await saveAnalysis("e1", { model: "gemma" });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.device_id).toBeUndefined();
    expect(body.device_name).toBeUndefined();
  });
});
