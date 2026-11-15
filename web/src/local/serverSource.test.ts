import { describe, expect, it, vi } from "vitest";

import { serverSource } from "./serverSource";

/** Resposta crua do servidor, como o manifesto devolve de verdade. */
const MANIFESTO = {
  complete: false,
  contract: "1",
  instance_id: "abc",
  kind: "entries",
  items: [{ id: "e1" }, { id: "e2" }],
  next_cursor: "2",
};

describe("cliente de importacao", () => {
  it("le o manifesto pelo campo items e devolve o proximo cursor", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(MANIFESTO), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const fonte = serverSource("http://servidor.exemplo/", "token");
    const pagina = await fonte.manifest();

    expect(pagina.entries.map((item) => item.id)).toEqual(["e1", "e2"]);
    expect(pagina.next).toBe("2");
    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(url).toBe("http://servidor.exemplo/api/v1/sync/manifest?kind=entries&limit=500");
    vi.unstubAllGlobals();
  });

  it("nao inventa cursor quando o servidor terminou", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ...MANIFESTO, next_cursor: "" }), { status: 200 })),
    );
    const pagina = await serverSource("http://servidor.exemplo", "token").manifest("2");
    expect(pagina.next).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("leva o token no cabecalho e recusa resposta de erro", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ error: { message: "unauthorized" } }), { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(serverSource("http://servidor.exemplo", "segredo").entry("e1")).rejects.toThrow("401");

    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer segredo");
    vi.unstubAllGlobals();
  });

  it("devolve o markdown do corpo e a lista de apagadas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        new Response(
          JSON.stringify(
            String(url).includes("/notes")
              ? { notes: [{ content_markdown: "linha do servidor" }] }
              : { entries: [{ id: "e9", title: "Apagada" }] },
          ),
          { status: 200 },
        ),
      ),
    );
    const fonte = serverSource("http://servidor.exemplo", "token");
    expect(await fonte.body("e1")).toBe("linha do servidor");
    expect((await fonte.deleted()).map((item) => item.id)).toEqual(["e9"]);
    vi.unstubAllGlobals();
  });
});
