import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NoteRelations } from "./NoteRelations";
import type { Analysis } from "../types";

function analysis(patch: Partial<Analysis> = {}): Analysis {
  return {
    model: "teste",
    sentiment: 0.2,
    sentiment_label: "positivo",
    emotions: null,
    people: null,
    places: null,
    summary: "",
    themes: null,
    people_detail: null,
    places_detail: null,
    ...patch,
  };
}

/**
 * A nota no centro e o que a analise encontrou em volta. O no leva ao mesmo
 * destino dos chips; o numero fica no tooltip, nao no rotulo.
 */
describe("relacoes da nota", () => {
  it("desenha uma entidade por nome e abre pelo tipo certo", () => {
    const onOpen = vi.fn();
    render(
      <NoteRelations
        analysis={analysis({
          themes: [{ name: "relacionamentos", confidence: 0.9 }],
          people_detail: [{ name: "Cahilly", count: 2, relation: "amiga", sentiment: 0.4 }],
          places_detail: [{ name: "quarto", count: 1 }],
        })}
        onOpenEntity={onOpen}
      />,
    );

    expect(screen.getByRole("group", { name: "Relações desta nota" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Pessoa: Cahilly" }));
    expect(onOpen).toHaveBeenCalledWith("person", "Cahilly");

    fireEvent.click(screen.getByRole("button", { name: "Lugar: quarto" }));
    expect(onOpen).toHaveBeenCalledWith("place", "quarto");

    fireEvent.click(screen.getByRole("button", { name: "Tema: relacionamentos" }));
    expect(onOpen).toHaveBeenCalledWith("theme", "relacionamentos");
  });

  it("abre pelo teclado", () => {
    const onOpen = vi.fn();
    render(
      <NoteRelations
        analysis={analysis({ people_detail: [{ name: "Ana", count: 1, relation: "", sentiment: 0 }] })}
        onOpenEntity={onOpen}
      />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Pessoa: Ana" }), { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith("person", "Ana");
  });

  it("nao desenha nada sem entidade", () => {
    const { container } = render(<NoteRelations analysis={analysis()} onOpenEntity={vi.fn()} />);
    expect(container.querySelector("svg")).toBeNull();
  });
});
