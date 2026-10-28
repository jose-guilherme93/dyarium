import { describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import type { Attachment, Entry, Note, Notebook } from "../types";
import {
  importNotionSource,
  inspectNotionSource,
  readNotionFolder,
  readNotionZip,
  renderNotionMarkdown,
  type NotionApi,
  type NotionSource,
} from "./notionImport";
import type { NotionBlock } from "./notionHtml";
import fixture from "./__fixtures__/notion/posts-row.html?raw";

const PAGE_ID = "2ae9b5ae3c838019933dc79d240c6afc";
const HTML_PATH = "Export/Nota de exemplo 2ae9b5ae3c838019933dc79d240c6afc.html";
const IMAGE_PATH = "Export/Nota de exemplo/image.png";

function note(id = "note_1"): Note {
  return {
    id,
    entry_id: "entry",
    title: "",
    content_markdown: "",
    created_at: "2026-10-28T12:00:00Z",
    updated_at: "2026-10-28T12:00:00Z",
  };
}

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: PAGE_ID,
    title: "Nota de exemplo",
    status: "ready",
    source: "text",
    original_filename: "",
    content_type: "",
    size_bytes: 0,
    duration_seconds: 0,
    sha256: "",
    recorded_at: "2025-11-17T18:57:00Z",
    created_at: "2026-10-28T12:00:00Z",
    updated_at: "2026-10-28T12:00:00Z",
    notebook_id: "notion",
    ...overrides,
  };
}

function notebook(id = "notion", name = "Notion"): Notebook {
  return {
    id,
    name,
    color: "",
    is_default: false,
    entry_count: 0,
    created_at: "2026-10-28T12:00:00Z",
    updated_at: "2026-10-28T12:00:00Z",
  };
}

function attachment(id = "att_1"): Attachment {
  return {
    id,
    entry_id: PAGE_ID,
    kind: "image",
    content_type: "image/png",
    size_bytes: 4,
    created_at: "2026-10-28T12:00:00Z",
  };
}

function makeSource(html = fixture, image = true): NotionSource {
  const files = new Map();
  const htmlFile = new File([html], "Nota de exemplo.html", { type: "text/html" });
  files.set(HTML_PATH, { path: HTML_PATH, file: htmlFile });
  if (image) {
    const imageFile = new File([new Uint8Array([137, 80, 78, 71])], "image.png", { type: "image/png" });
    files.set(IMAGE_PATH, { path: IMAGE_PATH, file: imageFile });
  }
  return {
    files,
    html: [{ path: HTML_PATH, file: htmlFile }],
    fallbackYear: 2026,
    rootName: "Export",
    warnings: [],
  };
}

function makeClient(overrides: Partial<NotionApi> = {}) {
  const notebooks: Notebook[] = [];
  const createdEntry: { id: string; notebookId?: string; recordedAt?: string; title: string }[] = [];
  const notes: { entryId: string; markdown: string; title: string }[] = [];
  const uploads: { entryId: string; name: string }[] = [];
  const deleted: string[] = [];
  const deletedNotebooks: string[] = [];
  const patches: { id: string; notebook_id?: string }[] = [];
  const tags: { entryId: string; values: string[] }[] = [];

  const client: NotionApi = {
    listNotebooks: vi.fn(async () => ({ notebooks })),
    createNotebook: vi.fn(async (input) => {
      const created = notebook("notion-created", input.name);
      notebooks.push(created);
      return created;
    }),
    deleteNotebook: vi.fn(async (id) => {
      deletedNotebooks.push(id);
    }),
    createImportEntry: vi.fn(async (input) => {
      createdEntry.push({ id: input.id, notebookId: input.notebookId, recordedAt: input.recordedAt, title: input.title });
      return {
        entry: entry({ id: input.id, title: input.title, notebook_id: input.notebookId }),
        created: true,
      };
    }),
    listNotes: vi.fn(async () => ({ notes: [] })),
    uploadAttachment: vi.fn(async (entryId, file) => {
      uploads.push({ entryId, name: file.name });
      return attachment();
    }),
    deleteAttachment: vi.fn(async (id) => {
      deleted.push(id);
    }),
    createNote: vi.fn(async (entryId, title, markdown) => {
      notes.push({ entryId, markdown, title });
      return note();
    }),
    setEntryTags: vi.fn(async (entryId, values) => {
      tags.push({ entryId, values });
      return { status: "ok" };
    }),
    patchEntry: vi.fn(async (id, patch) => {
      patches.push({ id, ...patch });
      return { status: "ok" };
    }),
    updateNote: vi.fn(async () => ({ status: "ok", versions: {} })),
    ...overrides,
  };
  return { client, notebooks, createdEntry, notes, uploads, deleted, deletedNotebooks, patches, tags };
}

async function inspect(source: NotionSource) {
  return inspectNotionSource(source);
}

describe("inspectNotionSource", () => {
  it("conta paginas, imagens e a data original", async () => {
    const result = await inspect(makeSource());
    expect(result.counts.importable).toBe(1);
    expect(result.counts.images).toBe(1);
    expect(result.counts.withoutDate).toBe(0);
    expect(result.dateOptions.map((option) => option.name)).toEqual(["Criado em"]);
    expect(result.importable[0]?.recordedAt).toBe(new Date(2025, 10, 17, 15, 57).toISOString());
    expect(result.importable[0]?.preview?.length).toBeGreaterThan(0);
  });

  it("ignora o index.html sem id de pagina", async () => {
    const source = makeSource();
    const index = new File(["<html><body>indice</body></html>"], "index.html", { type: "text/html" });
    source.files.set("Export/index.html", { path: "Export/index.html", file: index });
    source.html.push({ path: "Export/index.html", file: index });
    const result = await inspect(source);
    expect(result.counts.importable).toBe(1);
    expect(result.warnings.some((warning) => warning.includes("sem id"))).toBe(true);
  });

  it("le a pasta pelo webkitRelativePath", () => {
    const source = readNotionFolder([
      new File(["<html></html>"], "a.html", { type: "text/html" }),
    ]);
    expect(source.html).toHaveLength(1);
  });

  it("le o zip do Notion, inclusive o zip que vem dentro dele", async () => {
    const inner = zipSync({
      [HTML_PATH]: strToU8(fixture),
      [IMAGE_PATH]: new Uint8Array([137, 80, 78, 71]),
    });
    const outer = zipSync({ "Export.zip": inner });
    const file = new File([outer], "Export.zip", { type: "application/zip" });
    const source = await readNotionZip(file);
    expect(source.html.map((entry) => entry.path)).toEqual([HTML_PATH]);
    const inspection = await inspectNotionSource(source);
    expect(inspection.counts.importable).toBe(1);
    expect(inspection.counts.images).toBe(1);

    const fake = makeClient({
      listNotebooks: async () => ({ notebooks: [notebook("notion", "Notion")] }),
    });
    const result = await importNotionSource(source, inspection, {
      fallbackYear: 2026,
      notebook: { kind: "existing", id: "notion" },
      client: fake.client,
    });
    expect(result.imported).toBe(1);
    expect(fake.uploads[0]?.name).toBe("image.png");
  });
});

describe("renderNotionMarkdown", () => {
  it("mantem a ordem imagem, link e texto", () => {
    const blocks: NotionBlock[] = [
      { kind: "image", src: "foto.png", caption: "", origin: "property" },
      { kind: "markdown", text: "[link](https://example.com)" },
      { kind: "markdown", text: "texto" },
    ];
    const page = {
      fileName: "",
      notionId: PAGE_ID,
      title: "T",
      description: "",
      blocks,
      tags: [],
      recordedAt: null,
      dateProperty: null,
      dateCandidates: [],
      properties: [],
      icon: "",
      isDatabaseIndex: false,
      warnings: [],
    };
    expect(renderNotionMarkdown(page, new Map([["foto.png", "att_1"]]))).toBe(
      "![](attachment:att_1)\n\n[link](https://example.com)\n\ntexto",
    );
  });
});

describe("importNotionSource", () => {
  it("cria o caderno Notion, a entrada com a data original, a imagem e a nota", async () => {
    const source = makeSource();
    const inspection = await inspect(source);
    const fake = makeClient();
    const result = await importNotionSource(source, inspection, {
      fallbackYear: 2026,
      notebook: { kind: "notion" },
      client: fake.client,
    });

    expect(fake.client.createNotebook).toHaveBeenCalledWith({ name: "Notion", color: "" });
    expect(fake.createdEntry).toEqual([
      {
        id: PAGE_ID,
        notebookId: "notion-created",
        recordedAt: new Date(2025, 10, 17, 15, 57).toISOString(),
        title: "Nota de exemplo",
      },
    ]);
    expect(fake.uploads).toEqual([{ entryId: PAGE_ID, name: "image.png" }]);
    expect(fake.notes).toHaveLength(1);
    const markdown = fake.notes[0]!.markdown;
    expect(markdown.startsWith("![](attachment:att_1)")).toBe(true);
    expect(markdown).toContain("[https://example.com/post](https://example.com/post)");
    expect(markdown).toContain("Primeiro parágrafo escrito no Notion");
    expect(markdown).not.toContain("Criado em");
    expect(result).toMatchObject({
      imported: 1,
      existing: 0,
      failed: 0,
      images: 1,
      notebookId: "notion-created",
      notebookName: "Notion",
      notebookCreated: true,
      firstEntryId: PAGE_ID,
    });
  });

  it("reusa um caderno Notion que ja existe", async () => {
    const source = makeSource();
    const inspection = await inspect(source);
    const existingNotebook = notebook("existing-notion", "notion");
    const fake = makeClient({
      listNotebooks: async () => ({ notebooks: [existingNotebook] }),
    });
    const result = await importNotionSource(source, inspection, {
      fallbackYear: 2026,
      notebook: { kind: "notion" },
      client: fake.client,
    });
    expect(fake.client.createNotebook).not.toHaveBeenCalled();
    expect(result.notebookId).toBe("existing-notion");
    expect(result.notebookCreated).toBe(false);
  });

  it("nao sobrescreve nota existente e move para o caderno escolhido", async () => {
    const source = makeSource();
    const inspection = await inspect(source);
    const fake = makeClient({
      listNotebooks: async () => ({ notebooks: [notebook("destino", "Destino")] }),
      createImportEntry: async (input) => ({
        entry: entry({ id: input.id, notebook_id: "outro" }),
        created: false,
      }),
      listNotes: vi.fn(async () => ({ notes: [note()] })),
    });
    const result = await importNotionSource(source, inspection, {
      fallbackYear: 2026,
      notebook: { kind: "existing", id: "destino" },
      client: fake.client,
    });
    expect(fake.client.listNotes).toHaveBeenCalledWith(PAGE_ID);
    expect(fake.client.createNote).not.toHaveBeenCalled();
    expect(fake.client.patchEntry).toHaveBeenCalledWith(PAGE_ID, { notebook_id: "destino" });
    expect(result).toMatchObject({ imported: 0, existing: 1, moved: 1, firstEntryId: PAGE_ID });
  });

  it("completa uma entrada que existe sem nota", async () => {
    const source = makeSource();
    const inspection = await inspect(source);
    const fake = makeClient({
      listNotebooks: async () => ({ notebooks: [notebook("notion", "Notion")] }),
      createImportEntry: async (input) => ({
        entry: entry({ id: input.id, notebook_id: "notion" }),
        created: false,
      }),
      listNotes: async () => ({ notes: [] }),
    });
    const result = await importNotionSource(source, inspection, {
      fallbackYear: 2026,
      notebook: { kind: "existing", id: "notion" },
      client: fake.client,
    });
    expect(fake.client.createNote).toHaveBeenCalledTimes(1);
    expect(result.imported).toBe(1);
  });

  it("importa tags da propriedade Tags", async () => {
    const html = `<html><body><article id="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"><header><h1 class="page-title">Com tags</h1><table class="properties"><tr class="property-row property-row-multi_select"><th>Tags</th><td><span class="selected-value">ideia</span><span class="selected-value">java</span></td></tr><tr class="property-row property-row-created_time"><th>Criado em</th><td><time datetime="2024-02-03T09:10">3 de fevereiro de 2024 09:10</time></td></tr></table></header><div class="page-body"><p>texto</p></div></article></body></html>`;
    const source = makeSource(html, false);
    const inspection = await inspect(source);
    const fake = makeClient({
      listNotebooks: async () => ({ notebooks: [notebook("notion", "Notion")] }),
    });
    await importNotionSource(source, inspection, {
      fallbackYear: 2026,
      notebook: { kind: "existing", id: "notion" },
      client: fake.client,
    });
    expect(fake.tags).toEqual([{ entryId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", values: ["ideia", "java"] }]);
  });

  it("acrescenta comentarios no comeco de uma nota que ja existia sem sobrescrever o corpo", async () => {
    const html = `<html><body><article id="dddddddddddddddddddddddddddddddd"><header><h1 class="page-title">Com comentario</h1><table class="properties"><tr class="property-row property-row-created_time"><th>Criado em</th><td><time datetime="2025-11-17T15:57">17 de novembro de 2025 15:57</time></td></tr></table></header><div class="page-body"><p>Texto novo do export.</p><div class="comment"><div class="comment-author">Ana</div><div class="comment-text">Comentario de bloco.</div></div></div><div class="comments"><div class="comment"><div class="comment-author">Bia</div><div class="comment-text">Comentario de pagina.</div></div></div></article></body></html>`;
    const source = makeSource(html, false);
    const inspection = await inspect(source);
    expect(inspection.counts.comments).toBe(2);

    const existingNote = {
      ...note("note_existing"),
      content_markdown: "Texto antigo da nota.\n\nComentários da página\n\n---",
      body_version: "v1",
    };
    const fake = makeClient({
      listNotebooks: async () => ({ notebooks: [notebook("notion", "Notion")] }),
      createImportEntry: async (input) => ({
        entry: entry({ id: input.id, notebook_id: "notion" }),
        created: false,
      }),
      listNotes: async () => ({ notes: [existingNote] }),
    });
    const result = await importNotionSource(source, inspection, {
      fallbackYear: 2026,
      notebook: { kind: "existing", id: "notion" },
      client: fake.client,
    });

    expect(fake.client.updateNote).toHaveBeenCalledTimes(1);
    const call = vi.mocked(fake.client.updateNote).mock.calls[0]!;
    expect(call[0]).toBe("note_existing");
    expect(call[1].startsWith("> **Bia**")).toBe(true);
    expect(call[1]).toContain("Texto antigo da nota.");
    expect(call[1].indexOf("> **Ana**")).toBeLessThan(call[1].indexOf("Texto antigo da nota."));
    expect(call[1].indexOf("Texto antigo da nota.")).toBeLessThan(call[1].length);
    expect(call[1]).toContain("> Comentario de bloco.");
    expect(call[1]).toContain("> **Bia**");
    expect(call[1]).not.toContain("Comentários da página");
    expect(call[1].endsWith("---")).toBe(false);
    expect(call[2]).toBe("v1");
    expect(result).toMatchObject({ imported: 0, existing: 1, updated: 1, comments: 2 });
  });

  it("nao repete comentario que a nota existente ja tem", async () => {
    const html = `<html><body><article id="eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"><header><h1 class="page-title">Com comentario</h1></header><div class="page-body"><p>Texto.</p><div class="comment"><div class="comment-author">Ana</div><div class="comment-text">Comentario.</div></div></div></article></body></html>`;
    const source = makeSource(html, false);
    const inspection = await inspect(source);
    const existingNote = {
      ...note("note_existing"),
      content_markdown: "Texto.\n\n> **Ana**\n>\n> Comentario.",
      body_version: "v1",
    };
    const fake = makeClient({
      listNotebooks: async () => ({ notebooks: [notebook("notion", "Notion")] }),
      createImportEntry: async (input) => ({
        entry: entry({ id: input.id, notebook_id: "notion" }),
        created: false,
      }),
      listNotes: async () => ({ notes: [existingNote] }),
    });
    const result = await importNotionSource(source, inspection, {
      fallbackYear: 2026,
      notebook: { kind: "existing", id: "notion" },
      client: fake.client,
    });
    expect(fake.client.updateNote).not.toHaveBeenCalled();
    expect(result).toMatchObject({ existing: 1, updated: 0, comments: 0 });
  });

  it("com comentarios desligados nao altera nota existente", async () => {
    const html = `<html><body><article id="ffffffffffffffffffffffffffffffff"><header><h1 class="page-title">Com comentario</h1></header><div class="page-body"><p>Texto.</p><div class="comment"><div class="comment-author">Ana</div><div class="comment-text">Comentario.</div></div></div></article></body></html>`;
    const source = makeSource(html, false);
    const inspection = await inspect(source);
    const fake = makeClient({
      listNotebooks: async () => ({ notebooks: [notebook("notion", "Notion")] }),
      createImportEntry: async (input) => ({
        entry: entry({ id: input.id, notebook_id: "notion" }),
        created: false,
      }),
      listNotes: async () => ({
        notes: [{ ...note("note_existing"), content_markdown: "Texto.", body_version: "v1" }],
      }),
    });
    const result = await importNotionSource(source, inspection, {
      fallbackYear: 2026,
      notebook: { kind: "existing", id: "notion" },
      updateExistingComments: false,
      client: fake.client,
    });
    expect(fake.client.updateNote).not.toHaveBeenCalled();
    expect(result).toMatchObject({ existing: 1, updated: 0, comments: 0 });
  });

  it("apaga a imagem enviada quando a nota falha", async () => {
    const source = makeSource();
    const inspection = await inspect(source);
    const fake = makeClient({
      listNotebooks: async () => ({ notebooks: [notebook("notion", "Notion")] }),
      createNote: async () => {
        throw new Error("falhou");
      },
    });
    const result = await importNotionSource(source, inspection, {
      fallbackYear: 2026,
      notebook: { kind: "existing", id: "notion" },
      client: fake.client,
    });
    expect(fake.deleted).toEqual(["att_1"]);
    expect(result.failed).toBe(1);
    expect(result.imported).toBe(0);
  });

  it("remove o caderno recem-criado quando nada foi importado", async () => {
    const source = makeSource();
    const inspection = await inspect(source);
    const fake = makeClient({
      createImportEntry: async () => {
        throw new Error("falhou");
      },
    });
    const result = await importNotionSource(source, inspection, {
      fallbackYear: 2026,
      notebook: { kind: "notion" },
      client: fake.client,
    });
    expect(fake.deletedNotebooks).toEqual(["notion-created"]);
    expect(result.failed).toBe(1);
  });

  it("para quando o usuario cancela entre paginas", async () => {
    const source = makeSource();
    const second = new File(
      [
        `<html><body><article id="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"><header><h1 class="page-title">Segunda</h1></header><div class="page-body"><p>outra</p></div></article></body></html>`,
      ],
      "Segunda.html",
      { type: "text/html" },
    );
    source.files.set("Export/Segunda.html", { path: "Export/Segunda.html", file: second });
    source.html.push({ path: "Export/Segunda.html", file: second });
    const inspection = await inspect(source);
    expect(inspection.counts.importable).toBe(2);
    const fake = makeClient({
      listNotebooks: async () => ({ notebooks: [notebook("notion", "Notion")] }),
    });
    let calls = 0;
    const result = await importNotionSource(source, inspection, {
      fallbackYear: 2026,
      notebook: { kind: "existing", id: "notion" },
      client: fake.client,
      isCancelled: () => {
        calls += 1;
        return calls > 1;
      },
    });
    expect(result.cancelled).toBe(true);
    expect(result.imported).toBe(1);
  });

  it("avisa imagem externa e nao tenta baixar", async () => {
    const html = fixture.replaceAll("Nota%20de%20exemplo/image.png", "https://example.com/foto.png");
    const source = makeSource(html, false);
    const inspection = await inspect(source);
    const fake = makeClient({
      listNotebooks: async () => ({ notebooks: [notebook("notion", "Notion")] }),
    });
    const result = await importNotionSource(source, inspection, {
      fallbackYear: 2026,
      notebook: { kind: "existing", id: "notion" },
      client: fake.client,
    });
    expect(fake.uploads).toHaveLength(0);
    expect(result.warnings.some((warning) => warning.includes("imagem externa"))).toBe(true);
    expect(fake.notes[0]?.markdown).not.toContain("attachment:");
  });
});
