import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MapView } from "./MapView";
import { api } from "../api";
import type { GraphResponse, Settings } from "../types";

vi.mock("../api", () => ({
  api: {
    getGraph: vi.fn(),
    listNotebooks: vi.fn(),
    getSettings: vi.fn(),
    getEntity: vi.fn(),
    getEntityMentions: vi.fn(),
    getAnalysis: vi.fn(),
    getMood: vi.fn(),
    setEntityIcon: vi.fn(),
    renameEntity: vi.fn(),
    claimSelf: vi.fn(),
  },
}));

const settings: Settings = {
  owner_name: "José",
  all_notes_mine: true,
  trim_silence: false,
  max_whisper_rss_mb: 0,
  whisper_model: "",
  whisper_language: "",
  transcribe_provider: "whisper",
  deepgram_model: "nova-3",
  deepgram_api_key_set: false,
  analyze_enabled: true,
  analyze_provider: "openai",
  analyze_local_runtime: "",
  analyze_base_url: "https://openrouter.ai/api/v1",
  analyze_model: "google/gemini-2.5-flash",
  analyze_api_key_set: true,
  analysis_themes: "",
  review_enabled: false,
  literal_transcript: false,
};

const graph: GraphResponse = {
  center: { id: "user", kind: "user", label: "José", mentions: 0, notes: 20 },
  nodes: [
    {
      id: "person:ana",
      kind: "person",
      label: "Ana",
      mentions: 12,
      notes: 8,
      sentiment: 0.4,
      last_seen: "2026-05-01T00:00:00Z",
    },
    {
      id: "place:recife",
      kind: "place",
      label: "Recife",
      mentions: 4,
      notes: 3,
      sentiment: -0.1,
      last_seen: "2026-04-01T00:00:00Z",
    },
    {
      id: "theme:familia",
      kind: "theme",
      label: "família",
      mentions: 6,
      notes: 5,
      sentiment: 0.2,
      last_seen: "2026-03-01T00:00:00Z",
    },
    {
      id: "decision:viajar",
      kind: "decision",
      label: "viajar em julho",
      mentions: 2,
      notes: 2,
      sentiment: 0.1,
      last_seen: "2026-02-01T00:00:00Z",
    },
  ],
  edges: [],
  total_nodes: 4,
  total_edges: 0,
  truncated: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getGraph).mockResolvedValue(graph);
  vi.mocked(api.listNotebooks).mockResolvedValue({ notebooks: [] });
  vi.mocked(api.getSettings).mockResolvedValue(settings);
  vi.mocked(api.getEntity).mockResolvedValue({
    kind: "person",
    name: "Ana",
    entries: 8,
    mentions: 12,
    sentiment: 0.4,
    last_seen: "2026-05-01T00:00:00Z",
    entry_list: [{ id: "entry-1", title: "Uma nota", date: "2026-05-01T00:00:00Z", count: 3 }],
  });
  vi.mocked(api.getEntityMentions).mockResolvedValue({
    mentions: [
      {
        entry_id: "entry-1",
        title: "Uma nota",
        date: "2026-05-01T00:00:00Z",
        source: "transcript",
        text: "fui ao recife com maria",
        term: "Maria",
        start_ms: 65000,
        end_ms: 70000,
        comment: "Uma tarde no Recife com Maria.",
      },
    ],
  });
  vi.mocked(api.getAnalysis).mockResolvedValue({ key_moments: [], sections: [] } as never);
  vi.mocked(api.getMood).mockResolvedValue({ mood: [] });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

function fakeContext() {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    setLineDash: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    bezierCurveTo: vi.fn(),
    closePath: vi.fn(),
    ellipse: vi.fn(),
    quadraticCurveTo: vi.fn(),
    rect: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    font: "",
    textAlign: "",
    textBaseline: "",
    lineCap: "",
    lineJoin: "",
  };
}

describe("MapView insights", () => {
  it("lista as entidades no trilho e abre o detalhe ao clicar", async () => {
    render(<MapView refreshKey={0} onOpen={() => undefined} />);

    expect(await screen.findByRole("heading", { name: "Insights" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Pessoas/ }));

    const entity = await screen.findByRole("button", { name: /Ana/ });
    expect(entity).toHaveTextContent("12 menções");
    fireEvent.click(entity);

    await waitFor(() => expect(api.getEntity).toHaveBeenCalledWith("person", "Ana"));
    expect(await screen.findByRole("heading", { name: "Ana" })).toBeInTheDocument();
  });

  it("troca de aba sem perder a lista do mapa", async () => {
    render(<MapView refreshKey={0} onOpen={() => undefined} />);

    fireEvent.click(await screen.findByRole("tab", { name: /Lugares/ }));

    expect(await screen.findByText("Recife")).toBeInTheDocument();
    expect(screen.queryByText("Ana")).not.toBeInTheDocument();
  });

  it("mostra o humor na aba do trilho", async () => {
    vi.mocked(api.getMood).mockResolvedValue({
      mood: [
        { date: "2026-05-01", sentiment: 0.4, entries: 2 },
        { date: "2026-05-02", sentiment: -0.2, entries: 1 },
      ],
    });

    render(<MapView refreshKey={0} onOpen={() => undefined} />);

    fireEvent.click(await screen.findByRole("tab", { name: /Humor/ }));

    expect(await screen.findByText(/Tom médio das 2 análises/)).toBeInTheDocument();
  });

  it("mostra o trecho onde a entidade aparece e a leitura da analise", async () => {
    render(<MapView refreshKey={0} onOpen={() => undefined} />);

    fireEvent.click(await screen.findByRole("tab", { name: /Pessoas/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Ana/ }));

    expect(await screen.findByText("Trechos")).toBeInTheDocument();
    expect(await screen.findByText(/Uma tarde no Recife com Maria/)).toBeInTheDocument();
    expect(await screen.findByText(/fui ao recife com/i)).toBeInTheDocument();
    expect(screen.getByText("1:05")).toBeInTheDocument();
  });

  it("seleciona a entidade que veio de uma nota", async () => {
    const applied = vi.fn();
    render(
      <MapView
        refreshKey={0}
        onOpen={() => undefined}
        focus={{ kind: "place", name: "Recife" }}
        onFocusApplied={applied}
      />,
    );

    await waitFor(() => expect(api.getEntity).toHaveBeenCalledWith("place", "Recife"));
    expect(applied).toHaveBeenCalled();
  });

  it("desenha a onda na camada do no selecionado", async () => {
    const contexts = new WeakMap<HTMLCanvasElement, ReturnType<typeof fakeContext>>();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      let ctx = contexts.get(this);
      if (!ctx) {
        ctx = fakeContext();
        contexts.set(this, ctx);
      }
      return ctx as unknown as CanvasRenderingContext2D;
    });

    const { container } = render(<MapView refreshKey={0} onOpen={() => undefined} />);
    fireEvent.click(await screen.findByRole("tab", { name: /Lugares/ }));
    const entity = await screen.findByRole("button", { name: /Recife/ });
    const ripple = container.querySelector(".map-ripple-canvas") as HTMLCanvasElement;

    fireEvent.click(entity);

    await waitFor(
      () => {
        const ctx = contexts.get(ripple);
        expect(ctx?.arc).toHaveBeenCalled();
      },
      { timeout: 3000 },
    );
  });
});
