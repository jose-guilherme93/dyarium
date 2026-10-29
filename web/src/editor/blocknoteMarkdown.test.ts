import { describe, expect, it } from "vitest";

import {
  audioAttachmentIds,
  blocksToNoteMarkdown,
  markdownToPlain,
  noteMarkdownToBlocks,
} from "./blocknoteMarkdown";
import { createNoteStyleSchema } from "./schema";

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

  it("imagem em largura total não ganha marcador", () => {
    const markdown = blocksToNoteMarkdown(editor, [
      { type: "image", props: { attachmentId: "at_2", caption: "", width: "" } },
    ] as never);
    expect(markdown).toBe("![](attachment:at_2)\n");
  });

  it("foto ainda subindo nao entra no corpo", () => {
    const markdown = blocksToNoteMarkdown(editor, [
      { type: "paragraph", content: "antes" },
      {
        type: "image",
        props: { attachmentId: "", caption: "", width: "", pending: true, preview: "blob:foto" },
      },
      { type: "paragraph", content: "depois" },
    ] as never);

    // Sem anexo nao ha marcador: o autosave nao pode gravar um `attachment:`
    // vazio nem uma imagem quebrada antes de o upload terminar.
    expect(markdown).not.toContain("attachment:");
    expect(markdown).not.toContain("![](");
    expect(markdown).toContain("antes");
    expect(markdown).toContain("depois");
  });

  it("audio vira bloco na posicao do marcador e volta igual", () => {
    const markdown = "Antes\n\n!audio[attachment:at_audio]{d=28.794}\n\nDepois";

    const blocks = noteMarkdownToBlocks(editor, markdown) as never as {
      type: string;
      props?: Record<string, string>;
    }[];
    expect(blocks.map((block) => block.type)).toEqual(["paragraph", "audio", "paragraph"]);
    const audio = blocks.find((block) => block.type === "audio");
    expect(audio?.props).toEqual({ attachmentId: "at_audio", duration: "28.794" });

    const again = blocksToNoteMarkdown(editor, blocks);
    expect(again).toContain("!audio[attachment:at_audio]{d=28.794}");
    expect(again).not.toContain("DYARIUMAUDIO");
    expect(again.indexOf("Antes")).toBeLessThan(again.indexOf("!audio"));
    expect(again.indexOf("!audio")).toBeLessThan(again.indexOf("Depois"));
  });

  it("audio sem duracao preserva o marcador sem {d=...}", () => {
    const blocks = noteMarkdownToBlocks(editor, "!audio[attachment:at_audio]") as never as {
      type: string;
      props?: Record<string, string>;
    }[];
    expect(blocks[0]?.props?.duration).toBe("");
    const again = blocksToNoteMarkdown(editor, blocks);
    expect(again.trim()).toBe("!audio[attachment:at_audio]");
  });

  it("texto do usuario que parece o marcador temporario nao e apagado", () => {
    const markdown = "DYARIUMAUDIOnao-e-bloco\n\nDepois";
    const again = blocksToNoteMarkdown(editor, noteMarkdownToBlocks(editor, markdown));
    expect(again).toContain("DYARIUMAUDIOnao-e-bloco");
  });

  it("imagem e audio em sequencia nao trocam de lugar", () => {
    const markdown = [
      "texto",
      "![foto](attachment:at_img){w=40}",
      "!audio[attachment:at_audio]{d=3.5}",
      "fim",
    ].join("\n");

    const blocks = noteMarkdownToBlocks(editor, markdown);
    const again = blocksToNoteMarkdown(editor, blocks);
    const image = again.indexOf("![foto](attachment:at_img){w=40}");
    const audio = again.indexOf("!audio[attachment:at_audio]{d=3.5}");
    expect(image).toBeGreaterThan(-1);
    expect(audio).toBeGreaterThan(image);
    expect(again.indexOf("fim")).toBeGreaterThan(audio);
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
    expect(again).toContain("2. dois");
  });

  it("lista numerada separada por linhas em branco volta numerada", () => {
    const markdown = "1. um\n\n2. dois\n\n3. tres";
    const blocks = noteMarkdownToBlocks(editor, markdown) as never as { type: string }[];

    expect(blocks.filter((block) => block.type === "numberedListItem")).toHaveLength(3);
    const again = blocksToNoteMarkdown(editor, blocks);
    expect(again).toContain("1. um");
    expect(again).toContain("2. dois");
    expect(again).toContain("3. tres");
  });

  it("menção a outra nota vira link para note:<id> e não some", () => {
    // Sem o toExternalHTML do bloco, o conversor do BlockNote descartava a menção
    // ao gerar o markdown: a nota ficava vazia depois da conversao.
    const markdown = blocksToNoteMarkdown(editor, [
      {
        type: "paragraph",
        content: [
          { type: "noteMention", props: { entryId: "note_abc", title: "gravacao.webm" } },
          { type: "text", text: " foi aqui", styles: {} },
        ],
      },
    ] as never);

    expect(markdown).toContain("[gravacao.webm](note:note_abc)");
    expect(markdown).toContain("foi aqui");
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

  it("tabela sobrevive a ida e a volta em markdown", () => {
    const markdown = "| a | b |\n| - | - |\n| 1 | 2 |\n";
    const blocks = noteMarkdownToBlocks(editor, markdown);
    expect(blocks.map((block) => block.type)).toContain("table");
    expect(blocksToNoteMarkdown(editor, blocks)).toContain("| a");
  });

  it("o schema não tem cor nem sublinhado: o markdown não sabe representar", () => {
    const styles = Object.keys(createNoteStyleSchema());
    expect(styles).toContain("bold");
    expect(styles).toContain("italic");
    expect(styles).not.toContain("underline");
    expect(styles).not.toContain("textColor");
    expect(styles).not.toContain("backgroundColor");
  });
});
describe("texto simples da nota", () => {
  it("nao deixa a largura da imagem nem a marcacao no texto contado", () => {
    const markdown = "![foto](attachment:abc){w=50}\n\n# Titulo\n\nTexto **forte**.";
    expect(markdownToPlain(markdown)).toBe("foto Titulo Texto forte.");
  });

  it("nao conta o marcador de audio como palavra", () => {
    const markdown = "Antes\n!audio[attachment:at_audio]{d=28.794}\nDepois";
    expect(markdownToPlain(markdown)).toBe("Antes Depois");
  });
});

describe("audios citados no corpo", () => {
  it("lista so os que tem marcador proprio", () => {
    const markdown = "!audio[attachment:at_a]{d=1}\n\nTexto\n\n!audio[attachment:at_b]";
    expect([...audioAttachmentIds(markdown)]).toEqual(["at_a", "at_b"]);
  });
});
