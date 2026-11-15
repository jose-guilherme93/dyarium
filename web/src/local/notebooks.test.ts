import { beforeEach, describe, expect, it } from "vitest";

import { registerNodeDatabase } from "./__fixtures__/nodeDb";

import {
  createLocalNotebook,
  deleteLocalNotebook,
  getLocalNotebook,
  listLocalNotebooks,
  updateLocalNotebook,
} from "./notebooks";
import * as local from "./notes";

beforeEach(async () => {
  await registerNodeDatabase();
});

describe("cadernos e livros no cofre local", () => {
  it("nasce com o caderno padrao", async () => {
    const cadernos = await listLocalNotebooks();
    expect(cadernos).toHaveLength(1);
    expect(cadernos[0].is_default).toBe(true);
  });

  it("cria um livro com os campos do modo escritor", async () => {
    const livro = await createLocalNotebook({
      name: "O livro",
      color: "",
      kind: "book",
      subtitle: "um romance",
      author: "José",
      goal_words: 50000,
      book_status: "drafting",
      page_size: "6x9",
      daily_goal_words: 500,
      deadline: "2027-01-31",
    });

    expect(livro.id).toMatch(/^nb_/);
    expect(livro).toMatchObject({
      name: "O livro",
      kind: "book",
      subtitle: "um romance",
      author: "José",
      goal_words: 50000,
      book_status: "drafting",
      page_size: "6x9",
      daily_goal_words: 500,
      deadline: "2027-01-31",
    });

    const lista = await listLocalNotebooks();
    expect(lista.map((caderno) => caderno.name)).toContain("O livro");
    expect(lista[0].is_default).toBe(true);
  });

  it("renomeia e muda ajustes sem perder o resto", async () => {
    const livro = await createLocalNotebook({ name: "Antes", color: "", kind: "book" });
    await updateLocalNotebook(livro.id, { name: "Depois", book_status: "revising" });

    const atualizado = await getLocalNotebook(livro.id);
    expect(atualizado).toMatchObject({ name: "Depois", book_status: "revising", kind: "book" });
  });

  it("conta as notas do caderno", async () => {
    const caderno = await createLocalNotebook({ name: "Viagens", color: "" });
    const nota = await local.createEntry({ title: "Serra", notebookId: caderno.id });
    expect(nota.notebook_id).toBe(caderno.id);

    const recarregado = await getLocalNotebook(caderno.id);
    expect(recarregado?.entry_count).toBe(1);
  });

  it("apagar devolve as notas para o caderno padrao", async () => {
    const caderno = await createLocalNotebook({ name: "Temporario", color: "" });
    const nota = await local.createEntry({ title: "Fica", notebookId: caderno.id });

    await deleteLocalNotebook(caderno.id);

    expect((await listLocalNotebooks()).map((item) => item.id)).not.toContain(caderno.id);
    expect((await local.getEntry(nota.id))?.notebook_id).toBe("notas-ao-acaso");
  });

  it("nao apaga o caderno padrao", async () => {
    const padrao = (await listLocalNotebooks())[0];
    await expect(deleteLocalNotebook(padrao.id)).rejects.toThrow(/padrao/);
  });
});
