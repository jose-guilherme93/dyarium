import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReviewChip } from "./ReviewChip";
import type { Segment, Transcript } from "../types";

function transcript(patch: Partial<Transcript> = {}): Transcript {
  return {
    model: "local",
    language: "pt",
    text: "texto",
    trim_silence: false,
    duration_seconds: 10,
    revised: true,
    ...patch,
  };
}

const SEGMENTS: Segment[] = [
  { start_ms: 0, end_ms: 1000, text: "a sede do pt", revised: "A sede do PT." },
  { start_ms: 1000, end_ms: 2000, text: "foram 3 pessoas" },
];

/**
 * A regra e mostrar, nao escrever: o chip diz quantos trechos mudaram, quantos
 * ficaram de fora e a compreensao; o antes/depois mora atras do toque.
 */
describe("estado da revisão no dashboard", () => {
  it("conta os trechos alterados e mostra a compreensão", () => {
    render(<ReviewChip transcript={transcript({ revised_comprehension: 78 })} segments={SEGMENTS} />);
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByTitle("Compreensão lógica estimada: 78 de 100")).toBeTruthy();
  });

  it("distingue revisão sem alteração de revisão inexistente", () => {
    const { container } = render(
      <ReviewChip transcript={transcript({ revised_comprehension: 80 })} segments={[SEGMENTS[1]]} />,
    );
    // Revisou e nao mudou nada: o chip existe e diz zero. "Nada a corrigir"
    // so aparece ao abrir, porque antes disso o texto seria uma frase solta.
    expect(container.querySelector(".review-chip")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Nada a corrigir neste texto.")).toBeTruthy();
  });

  it("não desenha nada quando a transcrição nunca foi revisada", () => {
    const { container } = render(
      <ReviewChip transcript={transcript({ revised: false })} segments={SEGMENTS} />,
    );
    expect(container.querySelector(".review-chip")).toBeNull();
  });

  it("mostra quantos trechos ficaram sem revisão", () => {
    const { container } = render(
      <ReviewChip transcript={transcript({ revised_rejected: 3 })} segments={SEGMENTS} />,
    );
    expect(container.querySelector(".review-chip__warn")?.textContent).toBe("3");
  });

  it("abre o antes e o depois ao tocar", () => {
    render(<ReviewChip transcript={transcript()} segments={SEGMENTS} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("a sede do pt")).toBeTruthy();
    expect(screen.getByText("A sede do PT.")).toBeTruthy();
  });
});
