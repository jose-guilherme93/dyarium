import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildLocalEntityDetail,
  buildLocalEntityMentions,
  buildLocalGraph,
  entityKey,
} from "./graphLocal";

vi.mock("../../../mobile/src/core/repo", () => ({
  listRecordings: vi.fn(),
}));

vi.mock("./analyze", () => ({
  listLocalAnalyses: vi.fn(),
}));

vi.mock("./settings", () => ({
  loadLocalSettings: vi.fn(),
}));

vi.mock("./notebooks", () => ({
  listLocalNotebooks: vi.fn(async () => []),
}));

import { listRecordings } from "../../../mobile/src/core/repo";
import type { Recording, TranscriptSegment } from "../../../mobile/src/core/types";

import { listLocalAnalyses } from "./analyze";
import { listLocalNotebooks } from "./notebooks";
import { loadLocalSettings } from "./settings";

import type { Analysis, Settings } from "../types";

const SETTINGS: Settings = {
  owner_name: "José",
  all_notes_mine: true,
  trim_silence: false,
  max_whisper_rss_mb: 0,
  whisper_model: "",
  whisper_language: "",
  transcribe_provider: "whisper",
  deepgram_model: "",
  deepgram_api_key_set: false,
  analyze_enabled: true,
  analyze_provider: "openai",
  analyze_local_runtime: "",
  analyze_base_url: "",
  analyze_model: "",
  analyze_api_key_set: true,
  analyze_concurrency: 0,
  analysis_themes: "",
  review_enabled: false,
  literal_transcript: false,
  mcp_paused: false,
  mcp_idle_hours: 12,
  mcp_history_sessions: 3,
  mcp_include_commits: true,
  mcp_include_links: true,
  mcp_store_full_path: false,
  mcp_machine_alias: "",
};

function recording(
  id: string,
  title: string,
  recordedAt: string,
  notebookId = "notas-ao-acaso",
  text = "",
  transcriptSegments: TranscriptSegment[] = [],
): Recording {
  return {
    id,
    title,
    recordedAt,
    createdAt: recordedAt,
    updatedAt: recordedAt,
    dir: `/tmp/${id}`,
    segmentCount: 0,
    status: "recorded",
    offset: 0,
    attempts: 0,
    notebookId,
    text,
    transcriptSegments,
  };
}

function analysis(entryId: string, body: Partial<Analysis>): { entry_id: string; analysis: Analysis } {
  return {
    entry_id: entryId,
    analysis: {
      model: "teste",
      sentiment: 0,
      sentiment_label: "neutro",
      emotions: null,
      people: null,
      places: null,
      summary: "",
      ...body,
    },
  };
}

const marinaEmPinheiros = analysis("nota-a", {
  sentiment: 0.5,
  people: ["Marina"],
  people_detail: [{ name: "Marina", count: 2, relation: "amiga", sentiment: 0.6 }],
  places: ["Pinheiros"],
  places_detail: [{ name: "Pinheiros", count: 1 }],
  themes: [{ name: "trabalho", confidence: 0.9 }],
  summary: "Um cafe com a Marina.",
  reading: "A conversa deixou o dia mais leve.",
});

const marinaDeNovo = analysis("nota-b", {
  sentiment: -0.5,
  people: ["Marina"],
  people_detail: [{ name: "Marina", count: 1, relation: "", sentiment: -0.5 }],
  themes: [{ name: "trabalho", confidence: 0.7 }],
  summary: "Assunto dificil com a Marina.",
  reading: "Ficou um assunto em aberto.",
});

beforeEach(() => {
  vi.mocked(loadLocalSettings).mockResolvedValue(SETTINGS);
  vi.mocked(listLocalNotebooks).mockResolvedValue([]);
  vi.mocked(listRecordings).mockResolvedValue([
    recording(
      "nota-a",
      "Dia 1",
      "2026-11-01T10:00:00Z",
      "notas-ao-acaso",
      "Hoje falei com a Marina no cafe de Pinheiros. Depois voltei.",
    ),
    recording(
      "nota-b",
      "Dia 2",
      "2026-11-10T10:00:00Z",
      "viagens",
      "Assunto dificil com a Marina. Nao rendeu.",
    ),
  ]);
  vi.mocked(listLocalAnalyses).mockResolvedValue([marinaEmPinheiros, marinaDeNovo]);
});

describe("grafo do cofre local", () => {
  it("deriva uma bola por entidade com mencoes e notas certas", async () => {
    const graph = await buildLocalGraph();

    expect(graph.center).toMatchObject({ id: "user", kind: "user", label: "José" });
    const marina = graph.nodes.find((node) => node.id === "person:marina");
    const pinheiros = graph.nodes.find((node) => node.id === "place:pinheiros");
    const trabalho = graph.nodes.find((node) => node.id === "theme:trabalho");

    expect(marina?.label).toBe("Marina");
    expect(marina?.mentions).toBe(3);
    expect(marina?.notes).toBe(2);
    expect(pinheiros).toMatchObject({ mentions: 1, notes: 1 });
    expect(trabalho).toMatchObject({ mentions: 2, notes: 2 });
    expect(graph.total_nodes).toBe(3);
    expect(graph.truncated).toBe(false);

    const centerToMarina = graph.edges.find(
      (edge) => edge.source === "user" && edge.target === "person:marina",
    );
    expect(centerToMarina).toMatchObject({ kind: "relation", weight: 2 });

    // Marina e trabalho dividem as duas notas.
    expect(
      graph.edges.find(
        (edge) =>
          edge.kind === "cooccurrence" &&
          [edge.source, edge.target].sort().join("|") === "person:marina|theme:trabalho",
      )?.weight,
    ).toBe(2);
  });

  it("no foco, cada nota ganha aresta de mencao para a entidade", async () => {
    const graph = await buildLocalGraph({ focus: "person:marina" });

    const notes = graph.nodes.filter((node) => node.kind === "note");
    expect(notes.map((node) => node.id).sort()).toEqual(["note:nota-a", "note:nota-b"]);
    expect(graph.edges.find((edge) => edge.source === "user")?.weight).toBe(2);

    const mentions = graph.edges.filter((edge) => edge.kind === "mention");
    expect(mentions).toContainEqual({
      source: "note:nota-a",
      target: "person:marina",
      kind: "mention",
      weight: 2,
    });
    expect(mentions).toContainEqual({
      source: "note:nota-a",
      target: "place:pinheiros",
      kind: "mention",
      weight: 1,
    });
    expect(mentions.some((edge) => edge.source === "note:nota-b" && edge.target === "place:pinheiros")).toBe(false);
    expect(graph.total_nodes).toBe(graph.nodes.length);
    expect(graph.total_edges).toBe(graph.edges.length);
  });

  it("filtra pelo caderno", async () => {
    const graph = await buildLocalGraph({ notebookId: "viagens" });

    expect(graph.nodes.map((node) => node.id).sort()).toEqual(["person:marina", "theme:trabalho"]);
    const marina = graph.nodes.find((node) => node.id === "person:marina");
    expect(marina).toMatchObject({ mentions: 1, notes: 1 });
  });

  it("filtra pelo periodo", async () => {
    const graph = await buildLocalGraph({ period: "2026-11-05T00:00:00Z" });

    expect(graph.nodes.map((node) => node.id).sort()).toEqual(["person:marina", "theme:trabalho"]);
    const marina = graph.nodes.find((node) => node.id === "person:marina");
    expect(marina?.notes).toBe(1);
  });

  it("nota sem analise nao inventa entidade", async () => {
    vi.mocked(listRecordings).mockResolvedValue([
      ...(await listRecordings()),
      recording("nota-sem-analise", "Sem analise", "2026-11-20T10:00:00Z", "notas-ao-acaso", "Fantasma apareceu aqui."),
    ]);

    const graph = await buildLocalGraph();

    expect(graph.nodes.some((node) => node.label === "Fantasma")).toBe(false);
    expect(graph.nodes.find((node) => node.id === "person:marina")?.notes).toBe(2);
  });

  it("cofre vazio devolve o grafo vazio sem estourar", async () => {
    vi.mocked(listRecordings).mockResolvedValue([]);
    vi.mocked(listLocalAnalyses).mockResolvedValue([]);

    const graph = await buildLocalGraph();

    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.total_nodes).toBe(0);
    expect(graph.total_edges).toBe(0);
    expect(graph.truncated).toBe(false);
  });

  it("ficha e trechos da entidade saem das mesmas notas", async () => {
    const detail = await buildLocalEntityDetail("person", "Marina");
    expect(detail).toMatchObject({ name: "Marina", entries: 2, mentions: 3 });
    expect(detail?.entry_list.map((entry) => entry.id).sort()).toEqual(["nota-a", "nota-b"]);

    const mentions = await buildLocalEntityMentions("person", "Marina");
    expect(mentions).toHaveLength(2);
    expect(mentions[0].text).toContain("Marina");
    expect(mentions[0].comment).toBeTruthy();
  });

  it("normaliza a chave da entidade sem acento e sem caixa", () => {
    expect(entityKey("  João   Pedro ")).toBe("joao-pedro");
    expect(entityKey("Marina")).toBe("marina");
  });
});
