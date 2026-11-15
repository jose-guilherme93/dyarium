import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Analise local com o provedor dublado.
 *
 * O cofre e o de verdade (`node:sqlite` + IndexedDB em memoria); so o `fetch` e
 * o mapa do IndexedDB sao falsos. Assim o teste cobre o texto que sai da nota,
 * o corpo enviado, a gravacao da analise e os erros de fronteira.
 */

const banco = new Map<string, unknown>();

vi.mock("../lib/idb", () => ({
  STORE_SETTINGS: "settings",
  ANALYSIS_STORE: "analysis",
  storeGet: async (_store: string, key: string) => banco.get(key),
  storeSet: async (_store: string, key: string, value: unknown) => {
    banco.set(key, value);
  },
  storeDelete: async (_store: string, key: string) => {
    banco.delete(key);
  },
}));

import { getRecording, upsertRecording } from "../../../mobile/src/core/repo";

import { registerNodeDatabase } from "./__fixtures__/nodeDb";

import {
  analyzeEntryLocally,
  clearLocalAnalysis,
  loadAnalyzeConfig,
  readLocalAnalysis,
} from "./analyze";
import * as local from "./notes";
import { saveLocalSettings } from "./settings";

beforeEach(async () => {
  banco.clear();
  await registerNodeDatabase();
});

/** Nota de texto com titulo e corpo, como a tela cria. */
async function notaComTexto(markdown = "Hoje fui ao mercado com a Ana."): Promise<string> {
  const nota = await local.createEntry({ title: "Dia comum" });
  await local.saveNote(nota.id, markdown);
  return nota.id;
}

interface Chamada {
  url: string;
  init: RequestInit;
}

/** `fetch` falso que guarda a requisicao e devolve um conteudo. */
function provedorFalso(
  conteudo: string,
  opcoes: { ok?: boolean; status?: number } = {},
): { fetchImpl: typeof fetch; chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    chamadas.push({ url: String(url), init: init ?? {} });
    return {
      ok: opcoes.ok ?? true,
      status: opcoes.status ?? 200,
      json: async () => ({ choices: [{ message: { content: conteudo } }] }),
    } as unknown as Response;
  }) as typeof fetch;
  return { fetchImpl, chamadas };
}

/** Configuracao completa do cofre, com chave. */
async function configurarProvedor(patch: Record<string, unknown> = {}): Promise<void> {
  await saveLocalSettings({
    analyze_provider: "openai",
    analyze_base_url: "https://api.exemplo.test/v1",
    analyze_model: "modelo-x",
    analyze_api_key: "sk-segredo",
    ...patch,
  });
}

/** JSON do provedor com numeros como string e listas faltando. */
const RESPOSTA = {
  comprehension: "82",
  sentiment: { score: "0.4", label: "positivo" },
  emotions: [{ name: "alegria", intensity: "0.7" }],
  people: [{ name: "Ana", count: "2", relation: "amiga", sentiment: "0.5" }],
  places: [{ name: "mercado", count: "1" }],
  themes: [{ name: "familia", confidence: "0.9" }],
  summary: "Fui ao mercado com a Ana.",
  reading: "Um dia tranquilo perto de quem importa.",
  key_moments: [{ start_ms: "12000", text: "encontrei a Ana" }],
  questions: ["devo voltar?"],
  decisions: ["comprar frutas"],
  tasks: ["pagar a conta"],
  ideas: [],
  events: ["ida ao mercado"],
  epiphanies: [],
};

describe("analise local", () => {
  it("le a configuracao crua com a chave e os temas", async () => {
    await configurarProvedor({ analysis_themes: "Casa, Fe", whisper_language: "en" });

    const config = await loadAnalyzeConfig();

    expect(config).toEqual({
      provider: "openai",
      baseUrl: "https://api.exemplo.test/v1",
      model: "modelo-x",
      apiKey: "sk-segredo",
      language: "en",
      themes: ["casa", "fe"],
    });
  });

  it("analisa, devolve o documento completo e grava no cofre", async () => {
    await configurarProvedor({ analysis_themes: "Trabalho, familia" });
    const id = await notaComTexto("Hoje fui ao mercado com a Ana.");
    const { fetchImpl, chamadas } = provedorFalso(`\`\`\`json\n${JSON.stringify(RESPOSTA)}\n\`\`\``);

    const analysis = await analyzeEntryLocally(id, { fetchImpl });

    expect(analysis).toMatchObject({
      origin: "api",
      model: "modelo-x",
      sentiment: 0.4,
      sentiment_label: "positivo",
      emotions: { alegria: 0.7 },
      emotions_detail: [{ name: "alegria", intensity: 0.7 }],
      people: ["Ana"],
      people_detail: [{ name: "Ana", count: 2, relation: "amiga", sentiment: 0.5 }],
      places: ["mercado"],
      places_detail: [{ name: "mercado", count: 1 }],
      themes: [{ name: "familia", confidence: 0.9 }],
      summary: "Fui ao mercado com a Ana.",
      reading: "Um dia tranquilo perto de quem importa.",
      key_moments: [{ start_ms: 12000, text: "encontrei a Ana" }],
      questions: ["devo voltar?"],
      decisions: ["comprar frutas"],
      tasks: ["pagar a conta"],
      ideas: [],
      events: ["ida ao mercado"],
      epiphanies: [],
      comprehension: 82,
      sentence_source: "model",
    });
    expect(await readLocalAnalysis(id)).toEqual(analysis);
    expect(banco.get(`analysis:${id}`)).toEqual(analysis);

    expect(chamadas).toHaveLength(1);
    const [chamada] = chamadas;
    expect(chamada.url).toBe("https://api.exemplo.test/v1/chat/completions");
    expect(chamada.url).not.toContain("sk-segredo");
    const headers = chamada.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-segredo");
    expect(headers["Content-Type"]).toBe("application/json");

    const corpo = JSON.parse(String(chamada.init.body)) as {
      model: string;
      temperature: number;
      response_format: { type: string };
      messages: { role: string; content: string }[];
    };
    expect(corpo.model).toBe("modelo-x");
    expect(corpo.temperature).toBe(0.2);
    expect(corpo.response_format).toEqual({ type: "json_object" });
    expect(corpo.messages[0].role).toBe("system");
    expect(corpo.messages[0].content).toContain("Responda SOMENTE");
    expect(corpo.messages[0].content).toContain("trabalho, familia");
    expect(corpo.messages[1]).toEqual({
      role: "user",
      content: expect.stringContaining("Dia comum"),
    });
    expect(corpo.messages[1].content).toContain("Hoje fui ao mercado com a Ana.");
    // A chave nao vai no corpo: so o cabecalho Bearer a leva.
    expect(String(chamada.init.body)).not.toContain("sk-segredo");
  });

  it("lanca sem texto e nao chama o provedor", async () => {
    await configurarProvedor();
    const nota = await local.createEntry({ title: "Vazia" });
    const { fetchImpl, chamadas } = provedorFalso("{}");

    await expect(analyzeEntryLocally(nota.id, { fetchImpl })).rejects.toThrow(
      "Esta nota ainda nao tem texto para analisar.",
    );
    expect(chamadas).toHaveLength(0);
  });

  it("sem chave lanca antes de chamar o provedor", async () => {
    await saveLocalSettings({
      analyze_provider: "openai",
      analyze_base_url: "https://api.exemplo.test/v1",
      analyze_model: "modelo-x",
    });
    const id = await notaComTexto();
    const { fetchImpl, chamadas } = provedorFalso("{}");

    await expect(analyzeEntryLocally(id, { fetchImpl })).rejects.toThrow(
      "Sem provedor de analise. Escolha o provedor e salve a chave em Configuracoes.",
    );
    expect(chamadas).toHaveLength(0);
    expect(await readLocalAnalysis(id)).toBeNull();
  });

  it("status de erro fala so o numero e nao grava nada", async () => {
    await configurarProvedor();
    const id = await notaComTexto();
    const { fetchImpl } = provedorFalso("corpo que nao deve vazar", { ok: false, status: 500 });

    await expect(analyzeEntryLocally(id, { fetchImpl })).rejects.toThrow(
      "O provedor recusou a analise (500).",
    );
    expect(await readLocalAnalysis(id)).toBeNull();
  });

  it("JSON invalido vira erro de formato", async () => {
    await configurarProvedor();
    const id = await notaComTexto();
    const { fetchImpl } = provedorFalso("desculpe, nao consigo analisar");

    await expect(analyzeEntryLocally(id, { fetchImpl })).rejects.toThrow(
      "O provedor respondeu em um formato inesperado.",
    );
    expect(await readLocalAnalysis(id)).toBeNull();
  });

  it("leva a transcricao com os tempos [mm:ss] no corpo", async () => {
    await configurarProvedor();
    const id = await notaComTexto("Manha de sabado.");
    const gravacao = await getRecording(id);
    if (!gravacao) throw new Error("a nota de teste sumiu do cofre");

    await upsertRecording({
      ...gravacao,
      transcript: "bom dia, depois boa tarde",
      transcriptLanguage: "pt",
      transcriptOrigin: "local",
      transcriptStatus: "ready",
      hasTranscript: true,
      transcriptSegments: [
        { start_ms: 0, end_ms: 1000, text: "bom dia" },
        { start_ms: 65_000, end_ms: 70_000, text: "boa tarde" },
      ],
    });

    const { fetchImpl, chamadas } = provedorFalso(JSON.stringify(RESPOSTA));
    await analyzeEntryLocally(id, { fetchImpl });

    const corpo = JSON.parse(String(chamadas[0].init.body)) as {
      messages: { role: string; content: string }[];
    };
    const enviado = corpo.messages[1].content;
    expect(enviado).toContain("Manha de sabado.");
    expect(enviado).toContain("[00:00] bom dia");
    expect(enviado).toContain("[01:05] boa tarde");
  });

  it("recusa provedor que so transcreve", async () => {
    await configurarProvedor({
      analyze_provider: "deepgram",
      analyze_base_url: "https://api.deepgram.com/v1",
    });
    const id = await notaComTexto();
    const { fetchImpl, chamadas } = provedorFalso("{}");

    await expect(analyzeEntryLocally(id, { fetchImpl })).rejects.toThrow(
      "Este provedor so transcreve audio.",
    );
    expect(chamadas).toHaveLength(0);
  });

  it("limpa a analise guardada", async () => {
    banco.set("analysis:note_x", { model: "modelo-x" });

    expect(await readLocalAnalysis("note_x")).toEqual({ model: "modelo-x" });
    await clearLocalAnalysis("note_x");
    expect(await readLocalAnalysis("note_x")).toBeNull();
  });
});
