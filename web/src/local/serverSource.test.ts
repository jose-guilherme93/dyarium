import { describe, expect, it, vi } from "vitest";

import type { ImportSource } from "./import";
import { serverSource } from "./serverSource";

/** O audio e opcional no contrato; aqui o teste exige que a fonte tenha. */
async function audioOf(fonte: ImportSource, id: string) {
  if (!fonte.audio) throw new Error("fonte sem audio");
  return fonte.audio(id);
}

/** Transcricao e analise sao opcionais no contrato; o teste exige as duas. */
async function transcriptOf(fonte: ImportSource, id: string) {
  if (!fonte.transcript) throw new Error("fonte sem transcricao");
  return fonte.transcript(id);
}

async function analysisOf(fonte: ImportSource, id: string) {
  if (!fonte.analysis) throw new Error("fonte sem analise");
  return fonte.analysis(id);
}

/** Cadernos sao opcionais no contrato; o teste exige que a fonte tenha. */
async function notebooksOf(fonte: ImportSource) {
  if (!fonte.notebooks) throw new Error("fonte sem cadernos");
  return fonte.notebooks();
}

/** A capa tambem e opcional no contrato; o teste exige que a fonte tenha. */
async function coverOf(fonte: ImportSource, id: string) {
  if (!fonte.cover) throw new Error("fonte sem capa");
  return fonte.cover(id);
}

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

  it("baixa o audio original com o token e devolve os bytes e o tipo", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "Content-Type": "audio/aac" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const audio = await audioOf(serverSource("http://servidor.exemplo", "segredo"), "e1");

    expect(audio?.contentType).toBe("audio/aac");
    expect([...(audio?.bytes ?? [])]).toEqual([1, 2, 3]);
    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(url).toBe("http://servidor.exemplo/api/v1/entries/e1/audio");
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer segredo");
    vi.unstubAllGlobals();
  });

  it("cai em audio/mp4 quando o servidor nao manda content-type", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([4]), { status: 200 })));

    const audio = await audioOf(serverSource("http://servidor.exemplo", "token"), "e1");

    expect(audio?.contentType).toBe("audio/mp4");
    vi.unstubAllGlobals();
  });

  it("nota sem audio responde 404 e vira null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nao encontrado", { status: 404 })));

    await expect(audioOf(serverSource("http://servidor.exemplo", "token"), "e1")).resolves.toBeNull();
    vi.unstubAllGlobals();
  });

  it("erro do servidor ao baixar audio vira excecao com status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("erro", { status: 500 })));

    await expect(audioOf(serverSource("http://servidor.exemplo", "token"), "e1")).rejects.toThrow("500");
    vi.unstubAllGlobals();
  });

  it("traz a transcricao com o texto, os segmentos e o token", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            text: "falei cedo",
            raw_text: "falei cedo",
            model: "large",
            segments: [
              { idx: 0, start_ms: 0, end_ms: 1200, text: "falei cedo", edited: false, reviewed: true },
              {
                idx: 1,
                start_ms: 1200,
                end_ms: 2600,
                text: "depois sai",
                revised: "depois saí",
                edited: true,
                reviewed: true,
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const transcricao = await transcriptOf(serverSource("http://servidor.exemplo", "segredo"), "e1");

    expect(transcricao).toEqual({
      text: "falei cedo",
      segments: [
        { start_ms: 0, end_ms: 1200, text: "falei cedo", reviewed: true },
        {
          start_ms: 1200,
          end_ms: 2600,
          text: "depois sai",
          revised: "depois saí",
          edited: true,
          reviewed: true,
        },
      ],
    });
    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(url).toBe("http://servidor.exemplo/api/v1/entries/e1/transcript");
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer segredo");
    vi.unstubAllGlobals();
  });

  it("traz a analise pronta com o token", async () => {
    const analise = {
      origin: "server",
      model: "gemma",
      sentiment: 0.4,
      sentiment_label: "positivo",
      emotions: { alegria: 0.6 },
      people: ["Ana"],
      places: [],
      summary: "um dia na serra",
    };
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify(analise), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const lida = await analysisOf(serverSource("http://servidor.exemplo", "segredo"), "e1");

    expect(lida).toEqual(analise);
    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(url).toBe("http://servidor.exemplo/api/v1/entries/e1/analysis");
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer segredo");
    vi.unstubAllGlobals();
  });

  it("404 de transcricao e de analise vira null, nao erro", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ error: "not_found" }), { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const fonte = serverSource("http://servidor.exemplo", "token");
    await expect(transcriptOf(fonte, "e1")).resolves.toBeNull();
    await expect(analysisOf(fonte, "e1")).resolves.toBeNull();
    vi.unstubAllGlobals();
  });

  it("erro de status em transcricao ou analise vira excecao", async () => {
    const fetchMock = vi.fn(async () => new Response("erro", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const fonte = serverSource("http://servidor.exemplo", "token");
    await expect(transcriptOf(fonte, "e1")).rejects.toThrow("500");
    await expect(analysisOf(fonte, "e1")).rejects.toThrow("500");
    vi.unstubAllGlobals();
  });

  it("traz os cadernos com o token", async () => {
    const cadernos = {
      notebooks: [
        {
          id: "viagens",
          name: "Viagens",
          color: "",
          is_default: false,
          kind: "notes",
          subtitle: "",
          author: "",
          synopsis: "",
          language: "",
          goal_words: 0,
          book_status: "drafting",
          entry_count: 3,
          chapter_count: 0,
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-02-01T00:00:00Z",
        },
        {
          id: "livro",
          name: "O livro",
          color: "",
          is_default: false,
          kind: "book",
          subtitle: "",
          author: "José",
          synopsis: "",
          language: "",
          goal_words: 50000,
          book_status: "drafting",
          entry_count: 0,
          chapter_count: 4,
          created_at: "2025-01-15T00:00:00Z",
          updated_at: "2025-02-15T00:00:00Z",
        },
      ],
    };
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify(cadernos), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const lidos = await notebooksOf(serverSource("http://servidor.exemplo", "segredo"));

    expect(lidos.map((item) => item.id)).toEqual(["viagens", "livro"]);
    expect(lidos[1]).toMatchObject({ name: "O livro", kind: "book" });
    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(url).toBe("http://servidor.exemplo/api/v1/notebooks");
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer segredo");
    vi.unstubAllGlobals();
  });

  it("servidor sem a rota de cadernos responde 404 e vira lista vazia", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nao encontrado", { status: 404 })));

    await expect(notebooksOf(serverSource("http://servidor.exemplo", "token"))).resolves.toEqual([]);
    vi.unstubAllGlobals();
  });

  it("erro do servidor ao listar cadernos vira excecao", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("erro", { status: 500 })));

    await expect(notebooksOf(serverSource("http://servidor.exemplo", "token"))).rejects.toThrow(
      "500",
    );
    vi.unstubAllGlobals();
  });

  it("baixa a capa do caderno com o token e devolve os bytes e o tipo", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([7, 8, 9]), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const capa = await coverOf(serverSource("http://servidor.exemplo", "segredo"), "livro");

    expect(capa?.contentType).toBe("image/png");
    expect([...(capa?.bytes ?? [])]).toEqual([7, 8, 9]);
    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(url).toBe("http://servidor.exemplo/api/v1/notebooks/livro/cover");
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer segredo");
    vi.unstubAllGlobals();
  });

  it("caderno sem capa responde 404 e vira null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nao encontrado", { status: 404 })));

    await expect(
      coverOf(serverSource("http://servidor.exemplo", "token"), "livro"),
    ).resolves.toBeNull();
    vi.unstubAllGlobals();
  });

  it("erro do servidor ao baixar a capa vira excecao", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("erro", { status: 500 })));

    await expect(
      coverOf(serverSource("http://servidor.exemplo", "token"), "livro"),
    ).rejects.toThrow("500");
    vi.unstubAllGlobals();
  });
});

describe("prazo das requisicoes", () => {
  it("requisicao que nunca responde vira erro de prazo", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
      vi.stubGlobal("fetch", fetchMock);

      const pedido = serverSource("http://servidor.exemplo", "token").entry("e1");
      let assentou = false;
      void pedido.then(
        () => {
          assentou = true;
        },
        () => {
          assentou = true;
        },
      );
      const recusa = expect(pedido).rejects.toThrow("servidor nao respondeu em 30s");

      // Antes do prazo a requisicao ainda esta em andamento: sem 30 s nao ha erro.
      await vi.advanceTimersByTimeAsync(29_999);
      expect(assentou).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await recusa;

      // O sinal vai no `fetch` e e abortado quando o prazo estoura.
      const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
