import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ComposeDialog, type ComposeAnchor } from "./ComposeDialog";
import { api, uploadFile } from "../api";

vi.mock("../api", () => ({
  api: {
    patchEntry: vi.fn(async () => ({ status: "ok", versions: {} })),
  },
  uploadFile: vi.fn(async () => ({ entry_id: "novo", attachment_id: "a1" })),
}));

function renderDialog(notebookId?: string, anchor?: ComposeAnchor) {
  const onCreateText = vi.fn();
  const onImport = vi.fn();
  const onCreated = vi.fn();
  render(
    <ComposeDialog
      open
      anchor={anchor}
      notebookId={notebookId}
      onClose={() => undefined}
      onCreateText={onCreateText}
      onImport={onImport}
      onCreated={onCreated}
    />,
  );
  return { onCreateText, onImport, onCreated };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ComposeDialog", () => {
  it("abre colado abaixo do botao que o chamou", () => {
    renderDialog(undefined, { top: 80, bottom: 108, left: 260, right: 288 });
    const dialog = screen.getByRole("dialog", { name: "Nova nota" });
    expect(dialog).toHaveStyle({ top: "114px", left: "8px", width: "280px" });
  });

  it("cria a nota de texto direto", () => {
    const { onCreateText } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /Texto/ }));
    expect(onCreateText).toHaveBeenCalledTimes(1);
  });

  it("abre a importacao do Notion sem criar nota", () => {
    const { onImport, onCreateText } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /Notion/ }));
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onCreateText).not.toHaveBeenCalled();
  });

  it("troca para o passo de audio sem criar nada", () => {
    const { onCreateText } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /Áudio/ }));
    expect(screen.getByRole("dialog", { name: "Nova nota de áudio" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gravar" })).toBeInTheDocument();
    expect(onCreateText).not.toHaveBeenCalled();
  });

  it("envia o arquivo e abre a nota criada", async () => {
    const { onCreated } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /Áudio/ }));
    fireEvent.change(screen.getByLabelText("Escolher arquivo de áudio"), {
      target: { files: [new File(["audio"], "gravacao.webm", { type: "audio/webm" })] },
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("novo"));
    expect(uploadFile).toHaveBeenCalledTimes(1);
  });

  it("move o audio para o caderno escolhido", async () => {
    const { onCreated } = renderDialog("trabalho");
    fireEvent.click(screen.getByRole("button", { name: /Áudio/ }));
    fireEvent.change(screen.getByLabelText("Escolher arquivo de áudio"), {
      target: { files: [new File(["audio"], "gravacao.webm", { type: "audio/webm" })] },
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("novo"));
    expect(api.patchEntry).toHaveBeenCalledWith("novo", { notebook_id: "trabalho" });
  });
});
