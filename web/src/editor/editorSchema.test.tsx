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
