import { beforeEach, describe, expect, it } from "vitest";

import { registerNodeDatabase } from "./__fixtures__/nodeDb";

import {
  createLocalNotebook,
  deleteLocalNotebook,
  getLocalNotebook,
  listLocalNotebooks,
  updateLocalNotebook,
  upsertLocalNotebook,
} from "./notebooks";
import * as local from "./notes";
import type { Notebook } from "../types";

/** Caderno como `/api/v1/notebooks` devolve. */
function remoto({
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
    updated_at: "2025-02-01T00:00:00Z",
    ...over,
  };
}

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

  it("grava o caderno do servidor com o mesmo id e os campos do livro", async () => {
    const resultado = await upsertLocalNotebook(
      remoto({
        id: "livro-remoto",
        name: "O nome do vento",
        kind: "book",
        author: "Patrick",
        page_size: "6x9",
        goal_words: 90000,
        daily_goal_words: 700,
        deadline: "2027-01-31",
        has_cover: true,
        cover_updated_at: "2025-02-01T00:00:00Z",
      }),
    );

    expect(resultado).toBe("created");
    expect(await getLocalNotebook("livro-remoto")).toMatchObject({
      id: "livro-remoto",
      name: "O nome do vento",
      kind: "book",
      author: "Patrick",
      page_size: "6x9",
      goal_words: 90000,
      daily_goal_words: 700,
      deadline: "2027-01-31",
      has_cover: true,
      cover_updated_at: "2025-02-01T00:00:00Z",
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-02-01T00:00:00Z",
    });
  });

  it("atualiza o caderno so quando o remoto e mais novo", async () => {
    await upsertLocalNotebook(remoto({ id: "viagens", name: "Antes" }));

    const atualizado = await upsertLocalNotebook(
      remoto({ id: "viagens", name: "Depois", updated_at: "2025-06-01T00:00:00Z" }),
    );
    expect(atualizado).toBe("updated");
    expect((await getLocalNotebook("viagens"))?.name).toBe("Depois");

    const antigo = await upsertLocalNotebook(
      remoto({ id: "viagens", name: "Antigo", updated_at: "2025-03-01T00:00:00Z" }),
    );
    expect(antigo).toBe("unchanged");
    expect((await getLocalNotebook("viagens"))?.name).toBe("Depois");
    expect((await listLocalNotebooks()).filter((item) => item.id === "viagens")).toHaveLength(1);
  });
});
