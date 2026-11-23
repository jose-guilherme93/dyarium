import { beforeEach, describe, expect, it, vi } from "vitest";

const anexos = new Map<string, unknown>();

vi.mock("../lib/idb", () => ({
  ATTACHMENTS_STORE: "attachments",
  ANALYSIS_STORE: "analysis",
  COVERS_STORE: "covers",
  STORE_SETTINGS: "settings",
  storeSet: async (_store: string, key: string, value: unknown) => {
    anexos.set(key, value);
  },
  storeGet: async (_store: string, key: string) => anexos.get(key),
  storeList: async () => [...anexos.entries()],
  storeDelete: async (_store: string, key: string) => {
    anexos.delete(key);
  },
}));

import { registerNodeDatabase } from "./__fixtures__/nodeDb";

import { listLocalAttachments } from "./attachments";
import { readLocalAnalysis } from "./analyze";
import { localCoverBlob, localCoverUrl } from "./covers";
import { importEntries, type ImportSource } from "./import";
import { listLocalNotebooks, updateLocalNotebook } from "./notebooks";
import * as local from "./notes";
import { transcriptOf } from "./transcribe";
import type { Analysis, Entry, Notebook } from "../types";
import { getRecording, upsertRecording } from "../../../mobile/src/core/repo";

/** Servidor de mentira: manifesto, nota, corpo e lixeira em memoria. */
function fakeSource(over: Partial<ImportSource> = {}): ImportSource {
  const datas: Record<string, string> = { e1: "2025-03-04T10:00:00Z", e2: "2025-05-06T09:30:00Z" };
  return {
    manifest: async (cursor) => ({
      entries: cursor ? [] : [{ id: "e1" }, { id: "e2" }],
      next: "pagina-2",
    }),
    entry: async (id) => ({
      id,
      title: id === "e1" ? "Da serra" : "Do mar",
      status: "ready",
      source: "text",
      notebook_id: id === "e1" ? "viagens" : "notas-ao-acaso",
      original_filename: "",
      content_type: "",
      size_bytes: 0,
      duration_seconds: 0,
      sha256: "",
      recorded_at: datas[id],
      created_at: datas[id],
      updated_at: datas[id],
      tags: id === "e1" ? ["viagem"] : [],
      archived: false,
    }),
    body: async (id) => (id === "e1" ? "primeira linha\ndepois a segunda" : ""),
    deleted: async () => [],
    ...over,
  };
}

/** Transcricao como o servidor devolve: texto, tempos e as marcas da revisao. */
const TRANSCRICAO = {
  text: "falei cedo e depois sai",
  segments: [
    { start_ms: 0, end_ms: 1200, text: "falei cedo", reviewed: true },
    {
      start_ms: 1200,
      end_ms: 2600,
      text: "e depois sai",
      revised: "e depois saí",
      reviewed: true,
    },
  ],
};

/** Analise como o servidor devolve; so o que a ficha le de imediato. */
const ANALISE: Analysis = {
  origin: "server",
  model: "gemma",
  sentiment: 0.4,
  sentiment_label: "positivo",
  emotions: { alegria: 0.6 },
  people: ["Ana"],
  places: [],
  summary: "um dia na serra",
};

/** Caderno como `/api/v1/notebooks` devolve, com os campos do modo escritor. */
function caderno({
  id,
  name,
  ...over
}: Partial<Notebook> & { id: string; name: string }): Notebook {
  return {
    id,
    name,
    color: "",
    is_default: false,
    kind: "notes",
    subtitle: "",
    author: "",
    synopsis: "",
    language: "",
    goal_words: 0,
    book_status: "drafting",
    entry_count: 0,
    chapter_count: 0,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...over,
  };
}

/** Nota como o detalhe devolve; o caderno e a estrutura entram pelo `over`. */
function entrada(id: string, over: Partial<Entry> = {}): Entry {
  return {
    id,
    title: id,
    status: "ready",
    source: "text",
    notebook_id: "notas-ao-acaso",
    original_filename: "",
    content_type: "",
    size_bytes: 0,
    duration_seconds: 0,
    sha256: "",
    recorded_at: "2025-03-04T10:00:00Z",
    created_at: "2025-03-04T10:00:00Z",
    updated_at: "2025-03-04T10:00:00Z",
    tags: [],
    archived: false,
    ...over,
  };
}

/**
 * Servidor com dois cadernos e um capitulo de livro. `livro` muda o caderno do
 * livro (capa) e `over` a propria fonte (download da capa, por exemplo).
 */
function fonteComCadernos(
  over: Partial<ImportSource> = {},
  livro: Partial<Notebook> = {},
): ImportSource {
  return {
    manifest: async () => ({ entries: [{ id: "e1" }, { id: "e3" }] }),
    entry: async (id) =>
      id === "e3"
        ? entrada("e3", {
            title: "O encontro",
            notebook_id: "livro",
            chapter_kind: "chapter",
            chapter_position: 2048,
            chapter_status: "revising",
            chapter_goal_words: 1200,
            chapter_synopsis: "o reencontro na estrada",
            chapter_beats: "chega\nparte",
            chapter_notes: "rever o dialogo",
          })
        : entrada("e1", { title: "Da serra", notebook_id: "viagens" }),
    body: async () => "",
    deleted: async () => [],
    notebooks: async () => [
      caderno({ id: "viagens", name: "Viagens" }),
      caderno({
        id: "livro",
        name: "O livro",
        kind: "book",
        author: "José",
        page_size: "6x9",
        goal_words: 50000,
        updated_at: "2025-02-01T00:00:00Z",
        ...livro,
      }),
    ],
    ...over,
  };
}

/** Caderno do livro com capa, como o servidor marca no `has_cover`. */
const LIVRO_COM_CAPA: Partial<Notebook> = {
  has_cover: true,
  cover_updated_at: "2025-02-01T00:00:00Z",
};

beforeEach(async () => {
  anexos.clear();
  let seq = 0;
  URL.createObjectURL = vi.fn(() => `blob:local-${seq++}`);
  URL.revokeObjectURL = vi.fn();
  await registerNodeDatabase();
});

describe("importacao de um servidor", () => {
  it("traz titulo, data, caderno, tag e corpo", async () => {
    const resultado = await importEntries(fakeSource());

    expect(resultado).toMatchObject({ created: 2, updated: 0, trashed: 0 });

    const e1 = await local.getEntry("e1");
    expect(e1?.title).toBe("Da serra");
    expect(e1?.recorded_at).toBe("2025-03-04T10:00:00Z");
    expect(e1?.notebook_id).toBe("viagens");
    expect(e1?.tags).toEqual(["viagem"]);

    const notas = await local.listNotes("e1");
    expect(notas[0].content_markdown).toContain("primeira linha");
  });

  it("rodar de novo atualiza sem duplicar", async () => {
    await importEntries(fakeSource());
    const segundo = await importEntries(fakeSource());

    expect(segundo).toMatchObject({ created: 0, updated: 2 });
    expect((await local.listEntries()).filter((item) => item.id === "e1")).toHaveLength(1);
  });

  it("nao invade o corpo local quando o servidor nao tem corpo", async () => {
    await importEntries(fakeSource());
    await local.saveNote("e1", "texto escrito no navegador");

    await importEntries(
      fakeSource({ body: async () => "" }),
    );

    const notas = await local.listNotes("e1");
    expect(notas[0].content_markdown).toBe("texto escrito no navegador");
  });

  it("tombstone do servidor desce para a lixeira local", async () => {
    const resultado = await importEntries(
      fakeSource({
        deleted: async () => [
          {
            id: "e2",
            title: "Do mar",
            status: "ready",
            source: "text",
            notebook_id: "notas-ao-acaso",
            original_filename: "",
            content_type: "",
            size_bytes: 0,
            duration_seconds: 0,
            sha256: "",
            recorded_at: "2025-05-06T09:30:00Z",
            created_at: "2025-05-06T09:30:00Z",
            updated_at: "2025-05-07T00:00:00Z",
            deleted_at: "2025-05-07T00:00:00Z",
          },
        ],
      }),
    );

    expect(resultado.trashed).toBe(1);
    expect((await local.listEntries()).map((item) => item.id)).not.toContain("e2");
    expect((await local.listDeletedEntries()).map((item) => item.id)).toContain("e2");
  });

  it("conta o progresso ate o total do manifesto", async () => {
    const vistos: number[] = [];
    await importEntries(fakeSource(), (progresso) => vistos.push(progresso.done));
    expect(vistos.at(-1)).toBe(2);
  });

  it("traz o audio original com id deterministico e liga a nota a ele", async () => {
    const audio = async () => ({
      bytes: new Uint8Array([1, 2, 3, 4]),
      contentType: "audio/mp4",
    });
    const resultado = await importEntries(fakeSource({ audio }));

    expect(resultado).toMatchObject({ audios: 2, audiosFailed: 0 });

    const guardado = await listLocalAttachments("e1");
    expect(guardado).toHaveLength(1);
    expect(guardado[0]).toMatchObject({
      id: "att_e1",
      entry_id: "e1",
      kind: "original",
      content_type: "audio/mp4",
      size_bytes: 4,
    });
    expect((await getRecording("e1"))?.serverAttachmentId).toBe("att_e1");
    expect((await getRecording("e2"))?.serverAttachmentId).toBe("att_e2");
  });

  it("reimportar nao baixa o audio de novo nem duplica o anexo", async () => {
    const audio = vi.fn(async () => ({
      bytes: new Uint8Array([9, 8, 7]),
      contentType: "audio/aac",
    }));
    await importEntries(fakeSource({ audio }));
    expect(audio).toHaveBeenCalledTimes(2);

    const segundo = await importEntries(fakeSource({ audio }));

    expect(audio).toHaveBeenCalledTimes(2);
    expect(segundo).toMatchObject({ created: 0, updated: 2, audios: 2, audiosFailed: 0 });
    expect(await listLocalAttachments("e1")).toHaveLength(1);
    expect((await getRecording("e1"))?.serverAttachmentId).toBe("att_e1");
  });

  it("nota sem audio nao cria anexo nem liga id", async () => {
    const resultado = await importEntries(fakeSource({ audio: async () => null }));

    expect(resultado).toMatchObject({ audios: 0, audiosFailed: 0 });
    expect(await listLocalAttachments("e1")).toEqual([]);
    expect((await getRecording("e1"))?.serverAttachmentId).toBeUndefined();
  });

  it("falha de audio de uma nota nao interrompe as outras", async () => {
    const audio = vi.fn(async (id: string) => {
      if (id === "e2") throw new Error("500 falha");
      return { bytes: new Uint8Array([5]), contentType: "audio/mp4" };
    });
    const resultado = await importEntries(fakeSource({ audio }));

    expect(resultado).toMatchObject({ created: 2, audios: 1, audiosFailed: 1 });
    expect(await listLocalAttachments("e2")).toEqual([]);
    expect((await getRecording("e1"))?.serverAttachmentId).toBe("att_e1");
    expect((await local.getEntry("e2"))?.title).toBe("Do mar");
  });

  it("fonte sem audio mantem o comportamento e zera os contadores", async () => {
    const resultado = await importEntries(fakeSource());

    expect(resultado).toMatchObject({ audios: 0, audiosFailed: 0 });
    expect(await listLocalAttachments("e1")).toEqual([]);
  });

  it("traz a transcricao e a analise que ja existiam no servidor", async () => {
    const resultado = await importEntries(
      fakeSource({
        transcript: async (id) => (id === "e1" ? TRANSCRICAO : null),
        analysis: async (id) => (id === "e1" ? ANALISE : null),
      }),
    );

    expect(resultado).toMatchObject({
      transcripts: 1,
      analyses: 1,
      transcriptsFailed: 0,
      analysesFailed: 0,
    });

    const transcricao = await transcriptOf("e1");
    expect(transcricao?.text).toBe(TRANSCRICAO.text);
    // A leitura monta o trecho com o que a interface desenha: tempos, texto e
    // a revisao. O `reviewed` fica gravado no cofre, nao no objeto de leitura.
    expect(transcricao?.segments).toEqual([
      { idx: 0, start_ms: 0, end_ms: 1200, text: "falei cedo" },
      { idx: 1, start_ms: 1200, end_ms: 2600, text: "e depois sai", revised: "e depois saí" },
    ]);

    const gravacao = await getRecording("e1");
    expect(gravacao).toMatchObject({
      transcriptStatus: "ready",
      transcriptOrigin: "server",
      hasTranscript: true,
    });
    expect(gravacao?.transcriptSegments).toEqual(TRANSCRICAO.segments);

    // O corpo importado continua la: gravar a fala nao toca no texto escrito.
    expect((await local.listNotes("e1"))[0].content_markdown).toContain("primeira linha");

    expect((await readLocalAnalysis("e1"))?.summary).toBe("um dia na serra");
    // A nota sem transcricao nem analise nao ganha nada de mentira.
    expect(await transcriptOf("e2")).toBeNull();
    expect(await readLocalAnalysis("e2")).toBeNull();
  });

  it("404 nas duas nao cria transcricao nem analise", async () => {
    const resultado = await importEntries(
      fakeSource({ transcript: async () => null, analysis: async () => null }),
    );

    expect(resultado).toMatchObject({
      transcripts: 0,
      analyses: 0,
      transcriptsFailed: 0,
      analysesFailed: 0,
    });
    expect(await transcriptOf("e1")).toBeNull();
    expect(await readLocalAnalysis("e1")).toBeNull();
  });

  it("falha de transcricao ou analise de uma nota nao derruba as outras", async () => {
    const resultado = await importEntries(
      fakeSource({
        transcript: async (id) => {
          if (id === "e1") throw new Error("500 falha");
          return TRANSCRICAO;
        },
        analysis: async (id) => {
          if (id === "e1") throw new Error("500 falha");
          return ANALISE;
        },
      }),
    );

    expect(resultado).toMatchObject({
      created: 2,
      transcripts: 1,
      transcriptsFailed: 1,
      analyses: 1,
      analysesFailed: 1,
    });
    expect((await transcriptOf("e2"))?.text).toBe(TRANSCRICAO.text);
    expect((await readLocalAnalysis("e2"))?.summary).toBe("um dia na serra");
    // A nota que falhou continua importada, so sem a fala e a analise.
    expect(await transcriptOf("e1")).toBeNull();
    expect((await local.getEntry("e1"))?.title).toBe("Da serra");
  });

  it("nao apaga a transcricao feita aqui quando o servidor manda outra", async () => {
    await importEntries(fakeSource());
    const base = await getRecording("e1");
    if (!base) throw new Error("nota e1 ausente");
    await upsertRecording({
      ...base,
      transcript: "texto escrito no navegador",
      transcriptOrigin: "local",
      hasTranscript: true,
      transcriptStatus: "ready",
    });

    const resultado = await importEntries(
      fakeSource({ transcript: async (id) => (id === "e1" ? TRANSCRICAO : null) }),
    );

    expect((await getRecording("e1"))?.transcript).toBe("texto escrito no navegador");
    expect(resultado.transcripts).toBe(1);
  });

  it("fonte sem transcricao nem analise mantem o comportamento e zera os contadores", async () => {
    const resultado = await importEntries(fakeSource());

    expect(resultado).toMatchObject({
      transcripts: 0,
      analyses: 0,
      transcriptsFailed: 0,
      analysesFailed: 0,
    });
    expect(await transcriptOf("e1")).toBeNull();
    expect(await readLocalAnalysis("e1")).toBeNull();
  });
});

describe("notas que falham", () => {
  it("nota cujo detalhe lanca nao derruba a tarefa: as outras entram e failed conta", async () => {
    const base = fakeSource();
    const fonte: ImportSource = {
      ...base,
      manifest: async () => ({ entries: [{ id: "e1" }, { id: "e3" }, { id: "e2" }] }),
      entry: async (id) => {
        if (id === "e3") throw new Error("500 falha");
        return base.entry(id);
      },
    };

    const vistos: number[] = [];
    const resultado = await importEntries(fonte, (progresso) => vistos.push(progresso.done));

    expect(resultado).toMatchObject({ total: 3, created: 2, failed: 1 });
    expect((await local.getEntry("e1"))?.title).toBe("Da serra");
    expect((await local.getEntry("e2"))?.title).toBe("Do mar");
    // A nota que falhou nao entra com dado de mentira.
    expect(await local.getEntry("e3")).toBeNull();
    // O progresso anda mesmo na nota que falhou: a tarefa nao fica presa nela.
    expect(vistos.at(-1)).toBe(3);
  });

  it("falha ao ler o corpo da nota tambem conta em failed, sem parar as outras", async () => {
    const base = fakeSource();
    const fonte: ImportSource = {
      ...base,
      body: async (id) => {
        if (id === "e2") throw new Error("servidor nao respondeu em 30s");
        return base.body(id);
      },
    };

    const resultado = await importEntries(fonte);

    expect(resultado).toMatchObject({ created: 1, failed: 1 });
    expect((await local.getEntry("e1"))?.title).toBe("Da serra");
    expect((await local.listNotes("e1"))[0].content_markdown).toContain("primeira linha");
  });
});

describe("importacao em paralelo", () => {
  it("baixa varias notas ao mesmo tempo, sem passar do teto", async () => {
    let emVoo = 0;
    let pico = 0;
    const fonte = fakeSource({
      manifest: async () => ({
        entries: Array.from({ length: 12 }, (_, i) => ({ id: `e${i}` })),
      }),
      entry: async (id) => {
        emVoo += 1;
        pico = Math.max(pico, emVoo);
        await Promise.resolve();
        await Promise.resolve();
        emVoo -= 1;
        return {
          id,
          title: id,
          status: "ready",
          source: "text",
          notebook_id: "notas-ao-acaso",
          original_filename: "",
          content_type: "",
          size_bytes: 0,
          duration_seconds: 0,
          sha256: "",
          recorded_at: "2025-03-04T10:00:00Z",
          created_at: "2025-03-04T10:00:00Z",
          updated_at: "2025-03-04T10:00:00Z",
          tags: [],
          archived: false,
        };
      },
      body: async () => "",
    });

    const resultado = await importEntries(fonte);

    expect(resultado.created).toBe(12);
    expect(pico).toBeGreaterThan(1);
    expect(pico).toBeLessThanOrEqual(6);
  });

  it("nao pede audio de nota que o detalhe diz nao ter", async () => {
    const audio = vi.fn(async () => ({ bytes: new Uint8Array([1]), contentType: "audio/mp4" }));
    const fonte = fakeSource({
      entry: async (id) => ({
        id,
        title: id,
        status: "ready",
        source: "text",
        notebook_id: "notas-ao-acaso",
        original_filename: "",
        content_type: "",
        size_bytes: 0,
        duration_seconds: 0,
        sha256: "",
        recorded_at: "2025-03-04T10:00:00Z",
        created_at: "2025-03-04T10:00:00Z",
        updated_at: "2025-03-04T10:00:00Z",
        tags: [],
        archived: false,
        audios: [],
      }),
      audio,
    });

    const resultado = await importEntries(fonte);

    expect(audio).not.toHaveBeenCalled();
    expect(resultado.audios).toBe(0);
  });
});

describe("cadernos e capitulos na importacao", () => {
  it("traz os cadernos com o mesmo id e o caderno certo de cada nota", async () => {
    const resultado = await importEntries(fonteComCadernos());

    expect(resultado.notebooks).toBe(2);

    const cadernos = await listLocalNotebooks();
    const viagens = cadernos.find((item) => item.id === "viagens");
    const livro = cadernos.find((item) => item.id === "livro");
    expect(viagens).toMatchObject({ name: "Viagens", kind: "notes" });
    expect(livro).toMatchObject({ name: "O livro", kind: "book", author: "José", page_size: "6x9" });

    // A nota aponta para o caderno que agora existe aqui: nao cai no padrao.
    expect((await local.getEntry("e1"))?.notebook_id).toBe("viagens");
    expect((await local.listEntries({ notebook_id: "viagens" })).map((item) => item.id)).toEqual(["e1"]);
    expect(
      (await local.listEntries({ notebook_id: "notas-ao-acaso" })).map((item) => item.id),
    ).not.toContain("e1");
  });

  it("traz a estrutura do capitulo: posicao, tipo, estado e planejamento", async () => {
    await importEntries(fonteComCadernos());

    expect(await local.getEntry("e3")).toMatchObject({
      notebook_id: "livro",
      chapter_kind: "chapter",
      chapter_position: 2048,
      chapter_status: "revising",
      chapter_goal_words: 1200,
      chapter_synopsis: "o reencontro na estrada",
      chapter_beats: "chega\nparte",
      chapter_notes: "rever o dialogo",
    });
  });

  it("reimportar nao duplica caderno nem sobrescreve o local mais novo", async () => {
    await importEntries(fonteComCadernos());
    await updateLocalNotebook("viagens", { name: "Viagens minhas" });

    const segundo = await importEntries(fonteComCadernos());

    expect(segundo.notebooks).toBe(0);
    const cadernos = await listLocalNotebooks();
    expect(cadernos.filter((item) => item.id === "viagens")).toHaveLength(1);
    expect(cadernos.filter((item) => item.id === "livro")).toHaveLength(1);
    // O caderno local ficou mais novo que o remoto: o nome daqui vence.
    expect(cadernos.find((item) => item.id === "viagens")?.name).toBe("Viagens minhas");
  });
});

describe("capas dos cadernos na importacao", () => {
  const CAPA = { bytes: new Uint8Array([7, 8, 9]), contentType: "image/png" };

  it("baixa a capa do caderno que tem e grava no cofre local", async () => {
    const cover = vi.fn(async () => CAPA);

    const resultado = await importEntries(fonteComCadernos({ cover }, LIVRO_COM_CAPA));

    expect(resultado).toMatchObject({ covers: 1, coversFailed: 0 });
    expect(cover).toHaveBeenCalledWith("livro");
    const blob = await localCoverBlob("livro");
    expect(blob.type).toBe("image/png");
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([7, 8, 9]);
    // A capa fica desenhavel sem passar pelo servidor de novo.
    expect(localCoverUrl("livro")).toBeTruthy();
  });

  it("reimportar com a mesma versao nao baixa a capa de novo", async () => {
    const cover = vi.fn(async () => CAPA);
    const fonte = fonteComCadernos({ cover }, LIVRO_COM_CAPA);
    await importEntries(fonte);
    expect(cover).toHaveBeenCalledTimes(1);

    const segundo = await importEntries(fonte);

    expect(cover).toHaveBeenCalledTimes(1);
    expect(segundo).toMatchObject({ covers: 0, coversFailed: 0 });
    expect([...new Uint8Array(await (await localCoverBlob("livro")).arrayBuffer())]).toEqual([7, 8, 9]);
  });

  it("caderno sem capa nao chama o download", async () => {
    const cover = vi.fn(async () => CAPA);

    const resultado = await importEntries(fonteComCadernos({ cover }));

    expect(cover).not.toHaveBeenCalled();
    expect(resultado).toMatchObject({ covers: 0, coversFailed: 0 });
  });

  it("falha de uma capa nao interrompe as notas e conta no resumo", async () => {
    const cover = vi.fn(async () => {
      throw new Error("500 falha");
    });

    const resultado = await importEntries(fonteComCadernos({ cover }, LIVRO_COM_CAPA));

    expect(resultado).toMatchObject({ covers: 0, coversFailed: 1 });
    // As duas notas entraram mesmo sem a capa do livro.
    expect((await local.getEntry("e1"))?.title).toBe("Da serra");
    expect((await local.getEntry("e3"))?.title).toBe("O encontro");
    expect(await localCoverBlob("livro").catch(() => null)).toBeNull();
  });
});
