import { describe, expect, it } from "vitest";
if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    value: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
import { render, screen } from "@testing-library/react";
import { BlockNoteEditor } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";
import { createEditorSchema } from "./editorSchema";
import { noteMarkdownToBlocks } from "./blocknoteMarkdown";

describe("details render", () => {
  it("renders details", () => {
    const schema = createEditorSchema();
    const editor = BlockNoteEditor.create({ schema });
    editor.replaceBlocks(editor.document, noteMarkdownToBlocks(editor, ":::details open X\nbody line\n:::") as any);
    render(<BlockNoteView editor={editor} />);
    const details = screen.getByText("X").closest("details");
    expect(details).toBeTruthy();
    expect(details).toHaveAttribute("open");
    expect(screen.getByText("body line")).toBeTruthy();
  });
});