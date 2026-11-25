import { beforeEach, describe, expect, it } from "vitest";

import { registerNodeDatabase } from "./__fixtures__/nodeDb";

import { patchChapter, registerWriting, reorderChapters, todayKey, wordsIn } from "./chapters";
import { createLocalLink, deleteLocalLink, listLocalLinks } from "./links";
import {
  createLocalNotebook,
  deleteLocalNotebook,
  listLocalNotebooks,
} from "./notebooks";
import * as local from "./notes";

beforeEach(async () => {
  await registerNodeDatabase();
});

describe("capitulos no cofre local", () => {
  it("nasce no fim do livro, com tipo e posicao que crescem", async () => {
    const livro = await createLocalNotebook({ name: "Livro", color: "", kind: "book" });
    const primeiro = await local.createEntry({
      title: "Abertura",
      notebookId: livro.id,
      kind: "chapter",
    });
    const segundo = await local.createEntry({
      title: "Meio",
      notebookId: livro.id,
      kind: "chapter",
    });

    expect(primeiro).toMatchObject({ chapter_kind: "chapter", chapter_position: 1024 });
    expect(segundo.chapter_position).toBe(2048);

    const recarregado = await local.getEntry(segundo.id);
    expect(recarregado).toMatchObject({ chapter_kind: "chapter", chapter_position: 2048 });
  });

  it("grava status, meta, sinopse, beats e notas sem perder o resto", async () => {
    const livro = await createLocalNotebook({ name: "Livro", color: "", kind: "book" });
    const capitulo = await local.createEntry({
      title: "Cap 1",
      notebookId: livro.id,
      kind: "chapter",
    });

    await patchChapter(capitulo.id, {
      chapter_status: "revising",
      chapter_goal_words: 1200,
      chapter_synopsis: "ela chega",
      chapter_beats: "porta\ncarta",
      chapter_notes: "checar o nome",
    });

    const recarregado = await local.getEntry(capitulo.id);
    expect(recarregado).toMatchObject({
      title: "Cap 1",
      chapter_status: "revising",
      chapter_goal_words: 1200,
      chapter_synopsis: "ela chega",
      chapter_beats: "porta\ncarta",
      chapter_notes: "checar o nome",
    });
  });

  it("o patch da tela passa pelos campos do capitulo", async () => {
    const livro = await createLocalNotebook({ name: "Livro", color: "", kind: "book" });
    const capitulo = await local.createEntry({
      title: "Cap 2",
      notebookId: livro.id,
      kind: "chapter",
    });

    await local.patchEntry(capitulo.id, { chapter_status: "done", title: "Cap 2 (final)" });

    expect(await local.getEntry(capitulo.id)).toMatchObject({
      title: "Cap 2 (final)",
      chapter_status: "done",
    });
  });

  it("reordenar reescreve a posicao de todos", async () => {
    const livro = await createLocalNotebook({ name: "Livro", color: "", kind: "book" });
    const a = await local.createEntry({ title: "A", notebookId: livro.id, kind: "chapter" });
    const b = await local.createEntry({ title: "B", notebookId: livro.id, kind: "chapter" });

    await reorderChapters(livro.id, [
      { entry_id: b.id, chapter_kind: "chapter", chapter_status: "draft", position: 1024 },
      { entry_id: a.id, chapter_kind: "part", chapter_status: "done", position: 2048 },
    ]);

    expect(await local.getEntry(b.id)).toMatchObject({ chapter_position: 1024 });
    expect(await local.getEntry(a.id)).toMatchObject({
      chapter_position: 2048,
      chapter_kind: "part",
      chapter_status: "done",
    });
  });

  it("apagar o livro tira os capitulos da lista", async () => {
    const livro = await createLocalNotebook({ name: "Livro", color: "", kind: "book" });
    const capitulo = await local.createEntry({
      title: "Some",
      notebookId: livro.id,
      kind: "chapter",
    });

    await deleteLocalNotebook(livro.id);

    expect((await listLocalNotebooks()).map((item) => item.id)).not.toContain(livro.id);
    const vivos = await local.listEntries({ include_words: true });
    expect(vivos.map((entry) => entry.id)).not.toContain(capitulo.id);
  });

  it("conta as palavras do corpo quando a lista pede", async () => {
    const livro = await createLocalNotebook({ name: "Livro", color: "", kind: "book" });
    const capitulo = await local.createEntry({
      title: "Cap",
      notebookId: livro.id,
      kind: "chapter",
    });
    const corpo = "# Título\n\numa frase com cinco palavras";
    await local.createNote(capitulo.id, "Cap", corpo);

    const [naLista] = await local.listEntries({ notebook_id: livro.id, include_words: true });
    // Markdown vira texto antes de contar: "Título" conta, o "#" nao.
    expect(naLista.word_count).toBe(wordsIn(corpo));
    expect(naLista.word_count).toBe(6);
  });
});

describe("ritmo de escrita no cofre local", () => {
  it("soma a diferenca de palavras do dia e preenche os dias vazios", async () => {
    const livro = await createLocalNotebook({ name: "Livro", color: "", kind: "book" });
    const capitulo = await local.createEntry({
      title: "Cap",
      notebookId: livro.id,
      kind: "chapter",
    });

    await local.createNote(capitulo.id, "Cap", "uma duas tres");
    await local.saveNote(capitulo.id, "uma duas tres quatro cinco");

    const { writingRhythm } = await import("./chapters");
    const ritmo = await writingRhythm(livro.id, 7);
    expect(ritmo.today).toBe(5);
    expect(ritmo.days).toHaveLength(7);
    expect(ritmo.days[6]).toEqual({ day: todayKey(), words: 5 });
    expect(ritmo.days.slice(0, 6).every((dia) => dia.words === 0)).toBe(true);
  });

  it("apagar conta como escrita negativa, sem mostrar numero negativo", async () => {
    const livro = await createLocalNotebook({ name: "Livro", color: "", kind: "book" });
    const capitulo = await local.createEntry({
      title: "Cap",
      notebookId: livro.id,
      kind: "chapter",
    });

    await local.createNote(capitulo.id, "Cap", "uma duas tres quatro");
    await local.saveNote(capitulo.id, "uma");

    const { writingRhythm } = await import("./chapters");
    expect((await writingRhythm(livro.id, 7)).today).toBe(1);
  });

  it("caderno comum nao entra no ritmo", async () => {
    const caderno = await createLocalNotebook({ name: "Notas", color: "" });
    await local.createEntry({ title: "Nota", notebookId: caderno.id });

    await registerWriting(caderno.id, "", "uma duas tres");

    const { writingRhythm } = await import("./chapters");
    expect((await writingRhythm(caderno.id, 7)).today).toBe(0);
  });
});

describe("referencias do capitulo no cofre local", () => {
  it("cria, lista e apaga", async () => {
    const livro = await createLocalNotebook({ name: "Livro", color: "", kind: "book" });
    const capitulo = await local.createEntry({
      title: "Cap",
      notebookId: livro.id,
      kind: "chapter",
    });

    const link = await createLocalLink(capitulo.id, {
      url: "https://exemplo.test/fonte",
      label: "fonte",
    });
    expect(link.id).toMatch(/^lnk_/);

    const lista = await listLocalLinks(capitulo.id);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({
      from_entry_id: capitulo.id,
      url: "https://exemplo.test/fonte",
      label: "fonte",
    });

    await deleteLocalLink(link.id);
    expect(await listLocalLinks(capitulo.id)).toEqual([]);
  });
});
