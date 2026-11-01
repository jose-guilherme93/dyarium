import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BookDialog } from "./BookDialog";
import type { Notebook } from "../types";

function notebook(overrides: Partial<Notebook> = {}): Notebook {
  return {
    id: "nb",
    name: "Trabalho",
    color: "",
    is_default: false,
    kind: "notes",
    subtitle: "",
    author: "",
    synopsis: "",
    language: "",
    goal_words: 0,
    book_status: "drafting",
    entry_count: 0,
    chapter_count: 0,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

describe("dialogo do livro", () => {
  it("ativa o modo escritor em caderno vazio", () => {
    const onActivate = vi.fn();
    render(
      <BookDialog open notebook={notebook()} onClose={() => {}} onSave={() => {}} onActivate={onActivate} />,
    );
    expect(screen.getAllByText("Modo escritor").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Criar livro" }));
    expect(onActivate).toHaveBeenCalled();
  });

  it("explica o ritmo em palavras por dia", () => {
    render(
      <BookDialog
        open
        notebook={notebook({ kind: "book", name: "O nome do vento" })}
        onClose={() => {}}
        onSave={() => {}}
      />,
    );
    expect(screen.getByText("Palavras por dia")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("ex.: 500")).toBeInTheDocument();
    expect(screen.getByLabelText("Palavras por dia")).toBeInTheDocument();
  });

  it("oferece formatos de livro e fontes com previa da pagina", () => {
    render(
      <BookDialog
        open
        notebook={notebook({ kind: "book", name: "O nome do vento" })}
        onClose={() => {}}
        onSave={() => {}}
      />,
    );
    expect(screen.getByRole("radio", { name: /Romance/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /Garamond/ })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /^A4/ })).not.toBeInTheDocument();
    expect(screen.getByText(/A4 não é formato de livro/)).toBeInTheDocument();
    expect(screen.getByLabelText("Prévia da página")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Garamond/ }));
    expect(screen.getByRole("radio", { name: /Garamond/ })).toHaveAttribute("aria-checked", "true");
  });

  it("mostra o encaixe da capa em livro existente", () => {
    render(
      <BookDialog
        open
        notebook={notebook({ kind: "book", name: "O nome do vento" })}
        onClose={() => {}}
        onSave={() => {}}
        onCoverSave={async () => {}}
        onCoverRemove={async () => {}}
      />,
    );
    expect(screen.getByText("Capa")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Escolher foto" })).toBeInTheDocument();
    expect(screen.getByText("Sem foto")).toBeInTheDocument();
  });

  it("caderno cheio oferece mover as notas antes de ativar", () => {
    const onMoveNotes = vi.fn();
    const onActivate = vi.fn();
    render(
      <BookDialog
        open
        notebook={notebook({ entry_count: 3 })}
        onClose={() => {}}
        onSave={() => {}}
        onActivate={onActivate}
        onMoveNotes={onMoveNotes}
      />,
    );
    expect(screen.getAllByText(/3 notas/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Criar livro" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Mover 3 notas/ }));
    expect(onMoveNotes).toHaveBeenCalled();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("excluir livro exige o titulo exato", () => {
    const onDelete = vi.fn();
    render(
      <BookDialog
        open
        notebook={notebook({ kind: "book", name: "O nome do vento", chapter_count: 4 })}
        chapterCount={4}
        onClose={() => {}}
        onSave={() => {}}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Apagar ou converter" }));
    const button = screen.getByRole("button", { name: "Excluir livro" });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Confirmar exclusão do livro"), {
      target: { value: "O nome do vento" },
    });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onDelete).toHaveBeenCalledWith("O nome do vento");
  });
});
