import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FirstRun } from "./FirstRun";
import type { FolderLike } from "../local/folder";
import { pickFolder, supportsFolder } from "../local/folder";

vi.mock("../local/folder", () => ({
  pickFolder: vi.fn(),
  supportsFolder: vi.fn(() => true),
}));

const folder: FolderLike = {
  name: "Meus Documentos",
  getFileHandle: vi.fn(),
};

function gates() {
  const onFolderChosen = vi.fn();
  const onUseBrowserOnly = vi.fn();
  const onSelfHosted = vi.fn();
  render(
    <FirstRun
      onFolderChosen={onFolderChosen}
      onUseBrowserOnly={onUseBrowserOnly}
      onSelfHosted={onSelfHosted}
    />,
  );
  return { onFolderChosen, onUseBrowserOnly, onSelfHosted };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(supportsFolder).mockReturnValue(true);
  vi.mocked(pickFolder).mockResolvedValue(folder);
});

describe("FirstRun", () => {
  it("mantem o botao do Google visivel e inerte enquanto o login nao liga", () => {
    gates();
    expect(screen.getByRole("button", { name: "Continuar com Google" })).toBeDisabled();
    expect(screen.getByText("em breve")).toBeInTheDocument();
  });

  it("libera o botao quando googleReady, sem a etiqueta", () => {
    render(
      <FirstRun
        onFolderChosen={vi.fn()}
        onUseBrowserOnly={vi.fn()}
        onSelfHosted={vi.fn()}
        googleReady
      />,
    );
    expect(screen.getByRole("button", { name: "Continuar com Google" })).not.toBeDisabled();
    expect(screen.queryByText("em breve")).not.toBeInTheDocument();
  });

  it("escolher pasta mostra o nome e criar o cofre usa o handle escolhido", async () => {
    const { onFolderChosen } = gates();
    fireEvent.click(screen.getByRole("button", { name: /^Escolher pasta/ }));

    expect(await screen.findByText("Meus Documentos")).toBeInTheDocument();
    expect(screen.getByText("escolhida")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Criar cofre aqui" }));
    await waitFor(() => expect(onFolderChosen).toHaveBeenCalledWith(folder));
  });

  it("cancelar o seletor volta ao inicio sem erro e sem criar cofre", async () => {
    vi.mocked(pickFolder).mockRejectedValueOnce(new DOMException("cancelado", "AbortError"));
    const { onFolderChosen } = gates();
    fireEvent.click(screen.getByRole("button", { name: /^Escolher pasta/ }));

    await waitFor(() => expect(pickFolder).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: /^Escolher pasta/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Criar cofre aqui" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onFolderChosen).not.toHaveBeenCalled();
  });

  it("navegador sem File System Access oferece seguir neste navegador e confirma", async () => {
    vi.mocked(supportsFolder).mockReturnValue(false);
    const { onUseBrowserOnly } = gates();

    expect(screen.queryByRole("button", { name: /^Escolher pasta/ })).not.toBeInTheDocument();
    expect(screen.getByText(/o backup é um arquivo que você baixa/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Seguir neste navegador" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continuar" }));
    expect(onUseBrowserOnly).toHaveBeenCalledTimes(1);
    expect(pickFolder).not.toHaveBeenCalled();
  });

  it("usar so neste navegador com seletor disponivel tambem confirma antes", async () => {
    const { onUseBrowserOnly } = gates();
    fireEvent.click(screen.getByRole("button", { name: "Usar só neste navegador" }));
    expect(screen.getByText(/outro computador não as recupera/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(onUseBrowserOnly).toHaveBeenCalledTimes(1);
  });

  it("o rodape abre o caminho da instalacao propria", () => {
    const { onSelfHosted } = gates();
    fireEvent.click(screen.getByRole("button", { name: "Já tenho uma instalação própria" }));
    expect(onSelfHosted).toHaveBeenCalledTimes(1);
  });

  it("com googleReady e onDriveChosen, conectar mostra ocupado e o erro", async () => {
    let rejeitar: (erro: Error) => void = () => undefined;
    const onDriveChosen = vi.fn(
      () =>
        new Promise<void>((_, reject) => {
          rejeitar = reject;
        }),
    );
    render(
      <FirstRun
        onFolderChosen={vi.fn()}
        onUseBrowserOnly={vi.fn()}
        onSelfHosted={vi.fn()}
        googleReady
        onDriveChosen={onDriveChosen}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continuar com Google" }));

    expect(onDriveChosen).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Conectando/ })).toBeDisabled();

    rejeitar(new Error("sem permissao"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível abrir o cofre do Drive. Tente de novo.",
    );
  });

  it("erro 403 do Drive aparece como permissao, nao como 'tente de novo'", async () => {
    const onDriveChosen = vi.fn(async () => {
      throw new Error('Drive 403: {"error":{"message":"Google Drive API has not been used"}}');
    });
    render(
      <FirstRun
        onFolderChosen={vi.fn()}
        onUseBrowserOnly={vi.fn()}
        onSelfHosted={vi.fn()}
        googleReady
        onDriveChosen={onDriveChosen}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continuar com Google" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Sem permissão no Drive. A Drive API pode estar desligada no projeto.",
    );
  });
});
