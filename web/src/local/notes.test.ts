import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { registerNodeDatabase } from "./__fixtures__/nodeDb";

import { createLocalNotebook } from "./notebooks";
import * as local from "./notes";

beforeAll(async () => {
  await registerNodeDatabase();
});

describe("camada local da web", () => {
  it("cria a nota com a data de hoje e devolve na lista", async () => {
    const entry = await local.createEntry({ title: "Primeira" });
    expect(entry.title).toBe("Primeira");
    expect(entry.notebook_id).toBe("notas-ao-acaso");
    expect(entry.recorded_at?.slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));

    const lista = await local.listEntries();
    expect(lista.map((item) => item.id)).toContain(entry.id);
  });

  it("grava e le o corpo da nota", async () => {
    const entry = await local.createEntry({ title: "Com corpo" });
    const nota = await local.saveNote(entry.id, "linha um\n\nlinha dois");
    expect(nota?.content_markdown).toBe("linha um\n\nlinha dois");

    const lidas = await local.listNotes(entry.id);
    expect(lidas).toHaveLength(1);
    expect(lidas[0].content_markdown).toContain("linha dois");

    const atualizada = await local.getEntry(entry.id);
    expect(atualizada?.preview).toContain("linha um");
  });

  it("edita titulo e arquivamento sem perder o corpo", async () => {
    const entry = await local.createEntry({ title: "Antes" });
    await local.saveNote(entry.id, "texto");
    await local.patchEntry(entry.id, { title: "Depois", archived: true });

    const depois = await local.getEntry(entry.id);
    expect(depois?.title).toBe("Depois");
    expect(depois?.archived).toBe(true);

    const ativos = await local.listEntries({ archived: false });
    expect(ativos.map((item) => item.id)).not.toContain(entry.id);
  });

  it("tags entram e saem da nota", async () => {
    const entry = await local.createEntry({ title: "Com tags" });
    await local.setEntryTags(entry.id, ["viagem", "familia"]);
    expect(await local.entryTags(entry.id)).toEqual(["viagem", "familia"]);

    const todas = await local.listTags();
    expect(todas.map((tag) => tag.name)).toEqual(["familia", "viagem"]);
  });

  it("apagar vai para a lixeira e restaurar traz de volta", async () => {
    const entry = await local.createEntry({ title: "Some e volta" });
    await local.deleteEntry(entry.id);

    expect((await local.listEntries()).map((item) => item.id)).not.toContain(entry.id);
    expect((await local.listDeletedEntries()).map((item) => item.id)).toContain(entry.id);

    await local.restoreEntry(entry.id);
    expect((await local.listEntries()).map((item) => item.id)).toContain(entry.id);
  });

  it("lista o caderno padrao mesmo sem nota nenhuma", async () => {
    const cadernos = await local.listNotebooks();
    expect(cadernos.some((caderno) => caderno.is_default)).toBe(true);
  });
});

describe("livros fora das notas recentes no cofre local", () => {
  beforeEach(async () => {
    await registerNodeDatabase();
  });

  it("exclude_books tira o capitulo e mantem a nota do diario", async () => {
    const livro = await createLocalNotebook({ name: "Livro", color: "", kind: "book" });
    const nota = await local.createEntry({ title: "Nota do diario" });
    const capitulo = await local.createEntry({
      title: "Cap 1",
      notebookId: livro.id,
      kind: "chapter",
    });

    const recentes = (await local.listEntries({ exclude_books: true })).map((item) => item.id);
    expect(recentes).toContain(nota.id);
    expect(recentes).not.toContain(capitulo.id);

    // Sem o filtro o capitulo continua na lista, e o caderno do livro o mostra.
    expect((await local.listEntries()).map((item) => item.id)).toContain(capitulo.id);
    expect((await local.listEntries({ exclude_books: false })).map((item) => item.id)).toContain(
      capitulo.id,
    );
    expect(
      (await local.listEntries({ notebook_id: livro.id })).map((item) => item.id),
    ).toContain(capitulo.id);
  });

  it("exclui nota comum que mora num caderno de livro", async () => {
    const livro = await createLocalNotebook({ name: "Livro", color: "", kind: "book" });
    const caderno = await createLocalNotebook({ name: "Diario", color: "" });
    const ficha = await local.createEntry({ title: "Ficha", notebookId: livro.id });
    const nota = await local.createEntry({ title: "Nota", notebookId: caderno.id });

    const recentes = (await local.listEntries({ exclude_books: true })).map((item) => item.id);
    expect(recentes).not.toContain(ficha.id);
    expect(recentes).toContain(nota.id);
  });
});
