import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { WritingView } from "./WritingView";
import type { MetricsSnapshot } from "../types";

const SNAPSHOT: MetricsSnapshot = {
  device_id: "dev_1",
  device_name: "emulador",
  schema: 1,
  generated_at: "2026-10-16T12:00:00Z",
  received_at: "2026-10-16T12:01:00Z",
  writing: {
    notes: 3,
    with_text: 2,
    with_audio: 1,
    with_transcript: 1,
    words: 120,
    chars: 640,
    sentences: 9,
    paragraphs: 4,
    unique_words: 70,
    lexical_richness: 0.58,
    average_words_per_note: 60,
    average_sentence_words: 13.3,
    average_word_length: 5.1,
    top_words: [{ label: "projeto", value: 4 }],
    longest_words: [{ label: "extraordinario", value: 14 }],
    questions: 2,
    exclamations: 1,
    links: 0,
    images: 1,
    list_items: 3,
    transcript_words: 40,
    average_transcript_words: 40,
    active_days: 2,
    average_notes_per_active_day: 1.5,
    current_streak: 2,
    longest_streak: 2,
    wrote_today: true,
    top_weekday: { label: "terça", value: 2 },
    top_hour: { label: "noite", value: 2 },
    first_at: "2026-10-14T12:00:00Z",
    last_at: "2026-10-16T12:00:00Z",
    longest_note: { title: "sobre o projeto", words: 80 },
    monthly: [
      { label: "set 26", words: 0, notes: 0 },
      { label: "out 26", words: 120, notes: 3 },
    ],
    month_comparison_pct: null,
    sentiment: {
      analyzed: 2,
      average: 0.25,
      positive: 1,
      neutral: 1,
      negative: 0,
      top_positive: { title: "dia bom", score: 1 },
      top_negative: null,
    },
    weekday_hour: Array.from({ length: 7 }, () => Array.from({ length: 8 }, () => 0)),
    consistency: {
      days: [
        { key: "2026-10-15", wrote: true, notes: 1, words: 30 },
        { key: "2026-10-16", wrote: true, notes: 2, words: 90 },
      ],
      written_days: 2,
      tracked_days: 2,
      rate: 1,
      longest_run: 2,
    },
    insights: ["Você escreveu 120 palavras em 2 notas."],
  },
  history: {
    weekly: [
      { label: "05/10", words: 0, notes: 0 },
      { label: "12/10", words: 120, notes: 3 },
    ],
    calendar: [
      [
        { key: "2026-10-11", words: 0, notes: 0 },
        { key: "2026-10-12", words: 120, notes: 3 },
      ],
    ],
    max_weekly: 120,
    max_daily: 120,
  },
};

function mockApi(snapshots: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => JSON.stringify({ snapshots, schema: 1 }),
    })),
  );
}

describe("WritingView", () => {
  beforeEach(() => {
    localStorage.setItem("dyarium.token", "token-de-teste");
    vi.unstubAllGlobals();
  });

  it("mostra as metricas e os graficos enviados pelo app", async () => {
    mockApi([SNAPSHOT]);
    render(<WritingView refreshKey={0} />);

    await waitFor(() => expect(screen.getByText("120")).toBeInTheDocument());
    expect(screen.getByText("Palavras por semana")).toBeInTheDocument();
    expect(screen.getByText("Palavras por mês")).toBeInTheDocument();
    expect(screen.getByText("Histórico de escrita")).toBeInTheDocument();
    expect(screen.getByText("Quando você escreve (dia × hora)")).toBeInTheDocument();
    expect(screen.getByText("Você escreveu 120 palavras em 2 notas.")).toBeInTheDocument();
    expect(screen.getByText("emulador")).toBeInTheDocument();
    expect(screen.getByText(/projeto · 4/)).toBeInTheDocument();
  });

  it("avisa quando nenhum aparelho enviou metricas", async () => {
    mockApi([]);
    render(<WritingView refreshKey={0} />);

    await waitFor(() => expect(screen.getByText("Nenhuma metrica recebida ainda.")).toBeInTheDocument());
  });
});
