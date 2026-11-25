import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import type { MetricsSnapshot } from "../types";
import { HomeStart } from "./HomeStart";

const getMetrics = vi.fn();

vi.mock("../api", () => ({
  api: {
    getMetrics: () => getMetrics(),
  },
}));

function snapshot(overrides: Record<string, unknown> = {}): MetricsSnapshot {
  return {
    schema: 2,
    device_id: "web-1",
    device_name: "Navegador",
    generated_at: "2026-03-12T12:00:00.000Z",
    received_at: "2026-03-12T12:00:00.000Z",
    streak: { current: 5, longest: 21, wrote_today: true },
    windows: {
      "7d": {},
      "30d": {
        writing: {
          notes: 34,
          with_text: 34,
          words: 24180,
          top_words: [{ label: "reunião", value: 41 }],
        },
        topics: { themes: [{ label: "entrega", count: 12 }], people: [], places: [] },
        summary: [
          "Você escreveu 24.180 palavras em 34 notas.",
          "Você registrou notas em 22 dias.",
          "Uma terceira frase não deve aparecer.",
        ],
      },
      "365d": {},
    },
    ...overrides,
  } as unknown as MetricsSnapshot;
}

describe("HomeStart", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 2, 12, 9, 0, 0));
    getMetrics.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cumprimenta pela hora do aparelho", async () => {
    getMetrics.mockResolvedValue({ snapshots: [], schema: 2 });
    render(<HomeStart noteCount={0} onNewNote={() => {}} onOpenAnalysis={() => {}} />);

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Bom dia");
  });

  it("usa no máximo duas frases do resumo calculado", async () => {
    getMetrics.mockResolvedValue({ snapshots: [snapshot()], schema: 2 });
    render(<HomeStart noteCount={34} onNewNote={() => {}} onOpenAnalysis={() => {}} />);

    expect(await screen.findByText(/24\.180 palavras em 34 notas/)).toBeInTheDocument();
    expect(screen.queryByText(/terceira frase/)).toBeNull();
  });

  it("mostra palavra, assunto e números da janela de 30 dias", async () => {
    getMetrics.mockResolvedValue({ snapshots: [snapshot()], schema: 2 });
    render(<HomeStart noteCount={34} onNewNote={() => {}} onOpenAnalysis={() => {}} />);

    expect(await screen.findByText("reunião")).toBeInTheDocument();
    expect(screen.getByText("entrega")).toBeInTheDocument();
    expect(screen.getByText("24.180")).toBeInTheDocument();
  });

  it("sem resumo, mostra só a contagem que o cliente já tem", async () => {
    getMetrics.mockResolvedValue({ snapshots: [], schema: 2 });
    render(<HomeStart noteCount={128} onNewNote={() => {}} onOpenAnalysis={() => {}} />);

    expect(await screen.findByText(/128 notas/)).toBeInTheDocument();
    await waitFor(() => expect(getMetrics).toHaveBeenCalledTimes(1));
  });

  it("as duas ações do início chamam o que existia", async () => {
    getMetrics.mockResolvedValue({ snapshots: [], schema: 2 });
    const onNewNote = vi.fn();
    const onOpenAnalysis = vi.fn();
    render(<HomeStart noteCount={1} onNewNote={onNewNote} onOpenAnalysis={onOpenAnalysis} />);

    screen.getByRole("button", { name: /nova nota/i }).click();
    screen.getByRole("button", { name: /análise/i }).click();

    expect(onNewNote).toHaveBeenCalledTimes(1);
    expect(onOpenAnalysis).toHaveBeenCalledTimes(1);
  });
});
