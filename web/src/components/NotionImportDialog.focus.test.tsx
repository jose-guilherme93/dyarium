import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NotionImportDialog } from "./NotionImportDialog";

vi.mock("../lib/notionImport", () => ({
  readNotionSource: vi.fn(),
  inspectNotionSource: vi.fn(),
  importNotionSource: vi.fn(),
}));

describe("NotionImportDialog foco", () => {
  const setup = () =>
    render(
      <NotionImportDialog
        open
        notebooks={[]}
        currentNotebookId="notas-ao-acaso"
        onClose={vi.fn()}
        onFinished={vi.fn()}
        onOpenEntry={vi.fn()}
      />,
    );

  it("entra no dialogo e circula o Tab sem escapar para a navegacao", () => {
    setup();
    const dialog = screen.getByRole("dialog");

    // O foco inicial fica dentro do dialogo.
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Tab do ultimo controle volta ao primeiro, dentro do dialogo.
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    );
    focusables[focusables.length - 1].focus();
    fireEvent.keyDown(focusables[focusables.length - 1], { key: "Tab" });
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Shift+Tab tambem nao escapa.
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Tab", shiftKey: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
