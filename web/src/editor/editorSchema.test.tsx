import { describe, expect, it } from "vitest";
import { BlockNoteEditor } from "@blocknote/core";
import { createEditorSchema } from "./editorSchema";
import {
  blocksToNoteMarkdown,
  normalizeLegacyAttachmentImages,
  noteMarkdownToBlocks,
} from "./blocknoteMarkdown";

function editor() {
  return BlockNoteEditor.create({ schema: createEditorSchema() });
}

describe("imagem da nota no editor", () => {
  it("exporta a referencia attachment, sem HTML e sem token", () => {
    const instance = editor();
    const markdown = "texto\n\n![foto](attachment:abc123){w=50}";
    const blocks = noteMarkdownToBlocks(instance, markdown);
    const out = blocksToNoteMarkdown(instance, blocks);

    expect(out).toContain("![foto](attachment:abc123){w=50}");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("token=");
  });

  it("conserta o HTML que versoes antigas do painel gravaram", () => {
    const id = "88966d1ea7bb7e5997f7650d7573ea00";
    const legacy =
      'texto\n\n<figure><img src="/api/v1/attachments/' +
      id +
      '?token=dev-token"><figcaption>1000315674.jpg</figcaption></figure>';

    const normalized = normalizeLegacyAttachmentImages(legacy);
    expect(normalized).toContain(`![1000315674.jpg](attachment:${id})`);
    expect(normalized).not.toContain("token=");

    const instance = editor();
    const out = blocksToNoteMarkdown(instance, noteMarkdownToBlocks(instance, legacy));
    expect(out).toContain(`![1000315674.jpg](attachment:${id})`);
    expect(out).not.toContain("token=");
    expect(out).not.toContain("<img");
  });
});

describe("largura da imagem", () => {
  it("grava a porcentagem inteira e usa vazio para a largura total", async () => {
    const { imageWidthValue } = await import("./editorSchema");
    expect(imageWidthValue(100)).toBe("");
    expect(imageWidthValue(120)).toBe("");
    expect(imageWidthValue(50.4)).toBe("50");
    expect(imageWidthValue(2)).toBe("20");
  });
});

describe("audio da nota no editor do dashboard", () => {
  it("exporta o mesmo marcador que o app le, sem o texto temporario", () => {
    const instance = editor();
    const markdown = "Antes\n\n!audio[attachment:at_audio]{d=28.794}\n\nDepois";
    const out = blocksToNoteMarkdown(instance, noteMarkdownToBlocks(instance, markdown));

    expect(out).toContain("!audio[attachment:at_audio]{d=28.794}");
    expect(out).not.toContain("DYARIUMAUDIO");
    expect(out.match(/!audio\[/g)).toHaveLength(1);
  });
});
