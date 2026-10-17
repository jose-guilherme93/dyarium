import { describe, expect, it } from "vitest";

import { blocksToNoteMarkdown, noteMarkdownToBlocks } from "./blocknoteMarkdown";

/**
 * O editor do BlockNote precisa de DOM. Aqui usamos o editor real: o que importa
 * e que o markdown gerado e lido pelo mesmo caminho de producao.
 */
async function makeEditor() {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const define = (name: string, value: unknown) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  define("window", dom.window);
  define("document", dom.window.document);
  define("navigator", dom.window.navigator);
  define("HTMLElement", dom.window.HTMLElement);
  define("Node", dom.window.Node);
  define("DOMParser", dom.window.DOMParser);

  const { BlockNoteEditor } = await import("@blocknote/core");
  const { createNoteSchema } = await import("./schema");
  return BlockNoteEditor.create({ schema: createNoteSchema() });
}

const editor = await makeEditor();

describe("markdown da nota", () => {
  it("mantem imagem e a largura que o app definiu", () => {
    const markdown = blocksToNoteMarkdown(editor, [
      { type: "paragraph", content: "antes" },
      { type: "image", props: { attachmentId: "at_1", caption: "foto", width: "50" } },
      { type: "paragraph", content: "depois" },
    ] as never);

    expect(markdown).toContain("![foto](attachment:at_1){w=50}");

    const blocks = noteMarkdownToBlocks(editor, markdown) as never as {
      type: string;
      props?: Record<string, string>;
    }[];
    const image = blocks.find((block) => block.type === "image");
    expect(image?.props?.attachmentId).toBe("at_1");
    expect(image?.props?.width).toBe("50");
  });

  it("imagem em largura total nao ganha marcador", () => {
    const markdown = blocksToNoteMarkdown(editor, [
      { type: "image", props: { attachmentId: "at_2", caption: "", width: "" } },
    ] as never);
    expect(markdown).toBe("![](attachment:at_2)\n");
  });

  it("tabela, lista numerada e aninhada sobrevivem", () => {
    const markdown = [
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "1. um",
      "2. dois",
      "",
      "- x",
      "  - y",
    ].join("\n");

    const blocks = noteMarkdownToBlocks(editor, markdown) as never as { type: string }[];
    const types = blocks.map((block) => block.type);
    expect(types).toContain("table");
    expect(types.filter((type) => type === "numberedListItem")).toHaveLength(2);
    expect(types).toContain("bulletListItem");

    // Volta para markdown com a mesma estrutura.
    const again = blocksToNoteMarkdown(editor, blocks);
    expect(again).toContain("| a");
    expect(again).toContain("1. um");
  });

  it("titulo, citacao e codigo voltam com o markdown que o app le", () => {
    const markdown = "## Secao\n\n> uma citacao\n\n```\nlinha de codigo\n```\n";
    const blocks = noteMarkdownToBlocks(editor, markdown) as never as { type: string }[];
    const types = blocks.map((block) => block.type);
    expect(types).toContain("heading");
    expect(types).toContain("quote");
    expect(types).toContain("codeBlock");

    const again = blocksToNoteMarkdown(editor, blocks);
    expect(again).toContain("## Secao");
    expect(again).toContain("> uma citacao");
  });
});