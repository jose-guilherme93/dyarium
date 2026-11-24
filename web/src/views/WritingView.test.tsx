import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api } from "../api";
import { WritingView } from "./WritingView";
import type { MetricsSnapshot, MetricsWindow } from "../types";

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

function v2Window(words: number): MetricsWindow {
  return {
    from: "2026-09-20",
    to: "2026-10-19",
    writing: {
      notes: 2,
      with_text: 2,
      with_audio: 1,
      with_transcript: 1,
      words,
      chars: words * 5,
      sentences: 10,
      paragraphs: 4,
      unique_words: 50,
      lexical_richness: 0.5,
      average_words_per_note: words / 2,
      average_sentence_words: 12,
      average_word_length: 5,
      reading_minutes: Math.round((words / 200) * 10) / 10,
      top_words: [{ label: "projeto", value: 4 }],
      longest_words: [{ label: "extraordinario", value: 14 }],
      questions: 1,
      exclamations: 1,
      links: 0,
      images: 0,
      list_items: 0,
      active_days: 2,
      average_notes_per_active_day: 1,
      notes_per_week: 0.5,
      top_weekday: { label: "terça", value: 2 },
      top_hour: { label: "noite", value: 2 },
      weekday_hour: Array.from({ length: 7 }, () => Array.from({ length: 8 }, () => 0)),
      consistency: {
        days: [],
        written_days: 2,
        tracked_days: 2,
        rate: 1,
        longest_run: 2,
      },
      longest_note: null,
    },
    voice: {
      audio_count: 1,
      audio_minutes: 2,
      transcribed_minutes: 2,
      coverage: 1,
      words: 10,
      words_per_minute: 5,
      words_per_audio: 10,
      origin_local: 1,
      origin_server: 0,
      transcript_share: 0.2,
    },
    images: {
      count: 1,
      bytes_total: 2048,
      bytes_average: 2048,
      per_note: 0.5,
      notes_with_image: 1,
      notes_with_image_no_text: 0,
    },
    analysis: {
      notes_with_content: 2,
      notes_analyzed: 1,
      coverage: 0.5,
      stale: 0,
      simplified: 0,
      last_analyzed_at: null,
    },
    sentiment: {
      source: "analysis",
      analyzed: 1,
      positive: 1,
      neutral: 0,
      negative: 0,
      average: 0.5,
      top_positive: null,
      top_negative: null,
      emotions: [{ label: "alegria", count: 1, tone: "positive" }],
      series: [],
      granularity: "day",
    },
    topics: {
      themes: [{ label: "trabalho", count: 2 }],
      people: [{ label: "Ana", count: 1 }],
      places: [],
    },
    summary: [`Resumo ${words}.`],
  };
}

const V2_SNAPSHOT: MetricsSnapshot = {
  device_id: "web-teste",
  device_name: "Navegador",
  schema: 2,
  generated_at: "2026-10-19T12:00:00Z",
  received_at: "2026-10-19T12:01:00Z",
  streak: { current: 2, longest: 4, wrote_today: true },
  windows: {
    "7d": v2Window(70),
    "30d": v2Window(200),
    "365d": v2Window(900),
  },
  history: SNAPSHOT.history,
};

/** O dashboard le as entradas com texto do servidor e calcula aqui mesmo. */
function mockEntries(entries: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => JSON.stringify({ entries }),
    })),
  );
}

describe("WritingView", () => {
  beforeEach(() => {
    localStorage.setItem("dyarium.token", "token-de-teste");
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("desenha o snapshot calculado que recebe", async () => {
    vi.spyOn(api, "getMetrics").mockResolvedValue({ snapshots: [V2_SNAPSHOT], schema: 2 });
    render(<WritingView refreshKey={0} />);

    await waitFor(() => expect(screen.getByText("200")).toBeInTheDocument());
    expect(screen.getByText("Resumo 200.")).toBeInTheDocument();
    expect(screen.getByText("Sua voz")).toBeInTheDocument();
    expect(screen.getByText("Sobre o que você escreveu")).toBeInTheDocument();
    expect(screen.getByText("Imagens")).toBeInTheDocument();
    expect(screen.getByText(/trabalho · 2/)).toBeInTheDocument();
    expect(screen.queryByText(/schema/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "7 dias" })).toBeInTheDocument();
    expect(screen.getAllByText("↑").length).toBeGreaterThan(0);
    expect(screen.getAllByText("↓").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "7 dias" }));
    await waitFor(() => expect(screen.getByText("70")).toBeInTheDocument());
    expect(screen.getByText("Resumo 70.")).toBeInTheDocument();
  });

  it("calcula as métricas no navegador a partir das entradas do servidor", async () => {
    const now = new Date().toISOString();
    mockEntries([
      {
        id: "e1",
        title: "Nota do servidor",
        status: "ready",
        source: "text",
        original_filename: "",
        content_type: "",
        size_bytes: 0,
        duration_seconds: 0,
        sha256: "",
        recorded_at: now,
        created_at: now,
        updated_at: now,
        text: "cinco palavras para a nota",
      },
    ]);
    render(<WritingView refreshKey={0} />);

    await waitFor(() =>
      expect(screen.getByText("Você escreveu 5 palavras em 1 nota.")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/aparelho|navegador|schema/i)).not.toBeInTheDocument();
  });

  it("mostra o estado vazio quando o cofre não tem nota nenhuma", async () => {
    vi.spyOn(api, "getMetrics").mockResolvedValue({ snapshots: [], schema: 2 });
    render(<WritingView refreshKey={0} />);

    await waitFor(() => expect(screen.getByText("Nenhuma métrica ainda.")).toBeInTheDocument());
    expect(screen.queryByText(/aparelho|celular/i)).not.toBeInTheDocument();
  });
});
