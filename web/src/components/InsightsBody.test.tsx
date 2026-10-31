import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { InsightsBody } from "./InsightsBody";
import type { Analysis } from "../types";

const partial: Analysis = {
  model: "test-model",
  origin: "browser",
  sentiment: 0.4,
  sentiment_label: "positivo",
  emotions: { alegria: 0.6 },
  people: ["Maria"],
  people_detail: [{ name: "Maria", count: 2, relation: "", sentiment: 0.4 }],
  places: ["parque"],
  places_detail: [{ name: "parque", count: 1 }],
  themes: [{ name: "família", confidence: 0.5 }],
  summary: "",
  reading: null,
  decisions: ["vou viajar em julho"],
  tasks: ["comprar a passagem"],
  events: ["viagem para Minas"],
  coverage: {
    blocks_read: 2,
    blocks_total: 6,
    chars_read: 120,
    chars_total: 420,
    audio_ms: 0,
    partial: true,
  },
};

describe("InsightsBody", () => {
  it("desenha o documento parcial com a cobertura da leitura", () => {
    render(<InsightsBody analysis={partial} onOpenEntity={vi.fn()} live />);

    expect(screen.getAllByText("Maria").length).toBeGreaterThan(0);
    expect(screen.getAllByText("parque").length).toBeGreaterThan(0);
    expect(screen.getAllByText("família").length).toBeGreaterThan(0);
    expect(screen.getByText("vou viajar em julho")).toBeInTheDocument();
    expect(screen.getByText("comprar a passagem")).toBeInTheDocument();
    expect(screen.getByText("viagem para Minas")).toBeInTheDocument();
    expect(screen.getByText(/parcial · 2\/6 blocos/)).toBeInTheDocument();
  });
});
