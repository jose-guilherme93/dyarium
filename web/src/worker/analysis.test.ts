import { describe, expect, it } from "vitest";
import { analyzeNoteInBrowser, type LlmGenerate, type WorkerNote } from "./analysis";

const CHUNK = {
  tom: 60,
  pessoas: [{ nome: "Maria" }],
  lugares: [{ nome: "parque" }],
  emocoes: ["alegria"],
  temas: ["relacionamentos"],
  eventos: [],
  decisoes: [],
  tarefas: [],
  ideias: [],
  epifanias: [],
  momentos: [],
};

function note(text: string): WorkerNote {
  return {
    entryId: "entry-1",
    title: "Tarde no parque",
    text,
    transcript: "",
    segments: [],
  };
}

function fakeGenerate(options: { failAfter?: number; emptyFirst?: boolean } = {}): LlmGenerate {
  let chunks = 0;
  return async (input) => {
    const isSummary = Boolean(
      (input.schema as { properties?: Record<string, unknown> }).properties?.frase,
    );
    if (isSummary) {
      return {
        text: JSON.stringify({ frase: "Uma tarde no parque com Maria." }),
        promptTokens: 20,
        completionTokens: 8,
        wallMs: 40,
      };
    }
    chunks += 1;
    if (options.failAfter !== undefined && chunks > options.failAfter) {
      throw new Error("memoria insuficiente");
    }
    if (options.emptyFirst && chunks === 1) {
      return { text: JSON.stringify({ ...CHUNK, pessoas: [], lugares: [], emocoes: [], temas: [] }), promptTokens: 5, completionTokens: 4, wallMs: 10 };
    }
    return {
      text: JSON.stringify(CHUNK),
      promptTokens: 30,
      completionTokens: 20,
      wallMs: 100,
    };
  };
}

const LONG =
  "Hoje encontrei Maria no parque e ficamos conversando por muito tempo sobre a vida, o trabalho e os planos para o ano que vem. Foi uma tarde tranquila e alegre, daquelas que a gente guarda com carinho.";

describe("analyzeNoteInBrowser", () => {
  it("produces the same contract the server already accepts", async () => {
    const result = await analyzeNoteInBrowser(note(LONG), "test-model", fakeGenerate());
    const payload = result.payload as {
      schema_version: number;
      people: string[];
      places: string[];
      emotions: Record<string, number>;
      themes: { name: string }[];
      coverage: { blocks_read: number; blocks_total: number; partial: boolean };
      summary: string;
      origin: string;
    };
    expect(payload.schema_version).toBe(2);
    expect(payload.origin).toBe("browser");
    expect(payload.people).toContain("Maria");
    expect(payload.places).toContain("parque");
    expect(payload.emotions.alegria).toBeGreaterThan(0);
    expect(payload.themes.map((theme) => theme.name)).toContain("relacionamentos");
    expect(payload.coverage.blocks_read).toBe(payload.coverage.blocks_total);
    expect(payload.coverage.partial).toBe(false);
    expect(payload.summary.trim().length).toBeGreaterThan(0);
    expect(result.readNow).toBe(1);
    expect(result.rejected).toBe(0);
  });

  it("keeps a partial document when a block fails", async () => {
    const twoBlocks = `${LONG}\n\nNo dia seguinte voltei ao parque com Maria para caminhar de novo e falar sobre o trabalho, as contas e o que queremos mudar no próximo mês.`;
    const result = await analyzeNoteInBrowser(
      note(twoBlocks),
      "test-model",
      fakeGenerate({ failAfter: 1 }),
    );
    const payload = result.payload as { coverage: { partial: boolean; blocks_read: number; blocks_total: number } };
    expect(result.doc.blocksTotal).toBeGreaterThanOrEqual(2);
    expect(result.rejected).toBeGreaterThanOrEqual(1);
    expect(payload.coverage.partial).toBe(true);
    expect(payload.coverage.blocks_read).toBeLessThan(payload.coverage.blocks_total);
  });

  it("falls back to the derived sentence when the summary is not accepted", async () => {
    const generate: LlmGenerate = async (input) => {
      const isSummary = Boolean(
        (input.schema as { properties?: Record<string, unknown> }).properties?.frase,
      );
      if (isSummary) {
        return { text: JSON.stringify({ frase: "x" }), promptTokens: 0, completionTokens: 0, wallMs: 1 };
      }
      return { text: JSON.stringify(CHUNK), promptTokens: 1, completionTokens: 1, wallMs: 1 };
    };
    const result = await analyzeNoteInBrowser(note(LONG), "test-model", generate);
    const payload = result.payload as { summary: string; sentence_source: string };
    expect(payload.sentence_source).toBe("derived");
    expect(payload.summary).not.toBe("x");
  });
});
