import { beforeEach, describe, expect, it } from "vitest";

import { registerNodeDatabase } from "./__fixtures__/nodeDb";

import { importEntries, type ImportSource } from "./import";
import * as local from "./notes";

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

beforeEach(async () => {
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
});
