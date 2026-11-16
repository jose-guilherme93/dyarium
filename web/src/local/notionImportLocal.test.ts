/**
 * Import do Notion contra o cofre local de verdade (SQLite em memoria).
 *
 * Os testes de `lib/notionImport.test.ts` usam um duble da API e por isso nao
 * viram o que o cofre grava. Foi exatamente ai que o titulo se perdeu: o duble
 * aceitava qualquer coisa. Aqui a importacao passa pelo mesmo codigo que roda
 * no navegador e o resultado e lido do banco.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";

import fixture from "../lib/__fixtures__/notion/posts-row.html?raw";
import {
  importNotionSource,
  inspectNotionSource,
  readNotionZip,
  type NotionSource,
} from "../lib/notionImport";
import { registerNodeDatabase } from "./__fixtures__/nodeDb";
import * as local from "./notes";
import * as books from "./notebooks";
import { localNotionClient } from "./notionClient";

const PAGE_TITLE = "Nota de exemplo";
const HTML_PATH = `Export/${PAGE_TITLE} 2ae9b5ae3c838019933dc79d240c6afc.html`;

async function importar(): Promise<{ source: NotionSource; entryId: string }> {
  const zip = zipSync({ [HTML_PATH]: strToU8(fixture) });
  const source = await readNotionZip(new File([zip], "Export.zip", { type: "application/zip" }));
  const inspection = await inspectNotionSource(source, {});
  expect(inspection.importable[0]?.title).toBe(PAGE_TITLE);

  const result = await importNotionSource(source, inspection, {
    client: localNotionClient(async () => {
      throw new Error("este teste nao tem imagem");
    }),
    notebook: { kind: "notion" },
    fallbackYear: 2026,
    updateExistingComments: true,
  });
  expect(result.failures).toEqual([]);
  expect(result.firstEntryId).toBeTruthy();
  return { source, entryId: result.firstEntryId as string };
}

beforeEach(async () => {
  await registerNodeDatabase();
});

describe("import do Notion no cofre local", () => {
  it("grava o titulo da pagina, nao uma entrada sem nome", async () => {
    const { entryId } = await importar();
    const entry = await local.getEntry(entryId);
    expect(entry?.title).toBe(PAGE_TITLE);
  });

  it("grava o corpo da nota com o texto da pagina", async () => {
    const { entryId } = await importar();
    const notes = await local.listNotes(entryId);
    expect(notes[0]?.content_markdown ?? "").not.toBe("");
    expect(notes[0]?.title).toBe(PAGE_TITLE);
  });

  it("deixa a nota no caderno Notion", async () => {
    const { entryId } = await importar();
    const entry = await local.getEntry(entryId);
    const cadernos = await books.listLocalNotebooks();
    const notion = cadernos.find((item) => item.id === entry?.notebook_id);
    expect(notion?.name).toBe("Notion");
  });

  it("reimportar nao duplica a nota nem perde o titulo", async () => {
    const { entryId } = await importar();
    const antes = await local.listEntries({ include_words: true });

    const zip = zipSync({ [HTML_PATH]: strToU8(fixture) });
    const source = await readNotionZip(new File([zip], "Export.zip", { type: "application/zip" }));
    const inspection = await inspectNotionSource(source, {});
    await importNotionSource(source, inspection, {
      client: localNotionClient(async () => {
      throw new Error("este teste nao tem imagem");
    }),
      notebook: { kind: "notion" },
      fallbackYear: 2026,
      updateExistingComments: true,
    });

    const depois = await local.listEntries({ include_words: true });
    expect(depois).toHaveLength(antes.length);
    expect((await local.getEntry(entryId))?.title).toBe(PAGE_TITLE);
  });

  it("titulo vazio na nota nao apaga o nome da entrada", async () => {
    const entry = await local.createEntry({ title: "Nome que fica" });
    await local.createNote(entry.id, "", "corpo sem titulo");
    expect((await local.getEntry(entry.id))?.title).toBe("Nome que fica");
  });
});
