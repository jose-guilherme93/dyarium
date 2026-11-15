/**
 * Analise de uma nota no cofre local, por um provedor OpenAI-compativel.
 *
 * No modo local nao existe servidor para analisar: o texto da nota sai do
 * proprio navegador para o provedor que o dono configurou em Configuracoes. A
 * chave fica no IndexedDB e so este modulo a le; a tela continua vendo apenas
 * `analyze_api_key_set`.
 *
 * O prompt e o formato JSON sao os mesmos do servidor (`internal/analyze`),
 * para a ficha de insights nao mudar de forma dependendo de quem analisou.
 * Resultado vazio de verdade (nota sem texto escrito nem transcrito) falha
 * antes de qualquer chamada.
 */

import { ANALYSIS_STORE, STORE_SETTINGS, storeDelete, storeGet, storeSet } from "../lib/idb";
import { PROVIDER_PRESETS, providerFromSettings } from "../lib/modelCatalog";

import { getEntry, listNotes } from "./notes";
import { transcriptOf } from "./transcribe";

import type {
  Analysis,
  AnalysisEmotion,
  AnalysisPerson,
  AnalysisPlace,
  AnalysisTheme,
  KeyMoment,
  Segment,
  Transcript,
} from "../types";

/** Mesma chave que `settings.ts` grava; a leitura crua mora aqui. */
const CHAVE = "preferencias";
const TIMEOUT_MS = 90_000;

/** Provedores que so transcrevem audio; nao existe analise neles. */
const TRANSCRIBE_ONLY = new Set(["deepgram", "whisper"]);

/**
 * Temas fixos do servidor (`internal/analyze/types.go`), usados quando o dono
 * nao escolheu nenhum. A lista importa: o modelo e instruido a preferi-la.
 */
const DEFAULT_THEMES = [
  "familia",
  "trabalho",
  "saude",
  "relacionamentos",
  "dinheiro",
  "fe",
  "viagem",
  "estudos",
  "lazer",
  "casa",
  "amigos",
];

/**
 * A linha de autor do servidor quando o papel nao e conhecido. O cofre local
 * nao guarda o papel efetivo da nota neste ponto, entao vale a versao neutra:
 * melhor nao atribuir a primeira pessoa do que inventar o autor.
 */
const AUTHOR_UNKNOWN =
  "Nao se sabe quem gravou este audio; nao assuma que a primeira pessoa do texto e o autor do diario.";

/**
 * Prompt do sistema copiado de `internal/analyze/analyze.go` (systemPromptTemplate).
 * Os campos e as regras sao os mesmos; so os marcadores sao preenchidos aqui.
 */
const SYSTEM_PROMPT = `Voce analisa uma nota de diario pessoal: o texto que a pessoa escreveu e/ou a
transcricao do audio. Leia o material inteiro antes de responder; nao resuma so o comeco.
{author}
Responda SOMENTE com um objeto JSON valido, sem texto antes ou depois e sem markdown.
Use exatamente este formato:
{"comprehension": <0 a 100>,
 "sentiment": {"score": <-1 a 1>, "label": "positivo|neutro|negativo"},
 "emotions": [{"name": "<emocao em pt-BR>", "intensity": <0 a 1>}],
 "people": [{"name": "<nome>", "count": <numero de mencoes>, "relation": "<relacao com o autor ou vazio>", "sentiment": <-1 a 1>}],
 "places": [{"name": "<lugar>", "count": <numero de mencoes>}],
 "themes": [{"name": "<tema>", "confidence": <0 a 1>}],
 "summary": "<uma frase com o que foi dito, ate 15 palavras>",
 "reading": "<no maximo 2 frases curtas sobre o que o texto revela>",
 "key_moments": [{"start_ms": <tempo em milissegundos>, "text": "<trecho marcante>"}],
 "questions": ["<pergunta que o autor fez>"],
 "decisions": ["<decisao que o autor tomou>"],
 "tasks": ["<tarefa ou pendencia que o autor precisa fazer>"],
 "ideas": ["<ideia ou proposta do autor>"],
 "events": ["<acontecimento objetivo: enterro, viagem, mudanca>"],
 "epiphanies": ["<percepcao ou conclusao que muda o entendimento do autor>"]}
"comprehension" e uma estimativa textual de 0 a 100 de quanto o texto representa a fala com logica, sintaxe e
concordancia: 100 para um texto perfeito, 0 para um texto incomprehensivel. Voce nao ouve o audio.
"reading" tem no maximo 2 frases e 280 caracteres: diga o que o texto revela (tensao, repeticao, o que fica
em aberto), sem paragrafo e sem rotulo generico ("tom negativo", "texto pessoal"). O que importa sao as
metricas: sentimento, emocoes, pessoas, lugares, temas e momentos-chave. Nao escreva relatorio.
Regras: seja fiel ao texto e nao invente pessoas, lugares ou fatos; preencha "relation" e "sentiment" de pessoas
somente quando for inferivel; use os tempos [mm:ss] presentes no texto para calcular "start_ms"; prefira os temas:
{themes}; liste ate 8 momentos-chave quando o texto for longo; perguntas, decisoes, tarefas, ideias, eventos e epifanias devem ser curtos, ate 8 cada; cada item entra em uma lista so
(decisao e escolha feita, tarefa e obrigacao, ideia e proposta, epifania e a percepcao que muda o entendimento,
evento e o acontecimento objetivo).
Escreva todo o conteudo textual (resumo, analise, nomes de emocoes, relacoes, perguntas e decisoes) em {language}.
Texto curto: cada campo textual e uma linha, sem paragrafo.`;

/** Configuracao do provedor de analise, com a chave. Nao expor na interface. */
export interface LocalAnalyzeConfig {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  language: string;
  themes: string[];
}

/** Parte da leitura crua dos ajustes que a analise precisa. */
interface StoredAnalyzeSettings {
  analyze_provider?: string;
  analyze_local_runtime?: string;
  analyze_base_url?: string;
  analyze_model?: string;
  analyze_api_key?: string;
  analysis_themes?: string;
  whisper_language?: string;
}

/**
 * Le a configuracao crua, com a chave.
 *
 * Separado de `loadLocalSettings` de proposito: a chave nao volta para a tela,
 * so o caminho que chama a API enxerga este objeto.
 */
export async function loadAnalyzeConfig(): Promise<LocalAnalyzeConfig> {
  const stored = (await storeGet<StoredAnalyzeSettings>(STORE_SETTINGS, CHAVE)) ?? {};
  const provider = (stored.analyze_provider ?? "").trim();
  const baseUrl = (stored.analyze_base_url ?? "").trim();
  // O modelo escolhido vence; sem escolha, vale o do preset (a mesma sugestao
  // que o catalogo mostra na tela).
  const preset = providerFromSettings(
    provider,
    baseUrl,
    (stored.analyze_local_runtime ?? "").trim(),
  );
  const model = (stored.analyze_model ?? "").trim() || PROVIDER_PRESETS[preset]?.model || "";
  return {
    provider,
    baseUrl,
    model,
    apiKey: (stored.analyze_api_key ?? "").trim(),
    // A analise segue o idioma da transcricao; sem escolha, pt.
    language: (stored.whisper_language ?? "").trim() || "pt",
    themes: parseThemes(stored.analysis_themes ?? ""),
  };
}

/** CSV de temas, minusculo e aparado, como no servidor. */
function parseThemes(csv: string): string[] {
  return csv
    .split(",")
    .map((theme) => theme.trim().toLowerCase())
    .filter(Boolean);
}

/** Codigo de idioma para o nome que o prompt entende (mesma tabela do Go). */
function languageName(code: string): string {
  switch (code.trim().toLowerCase()) {
    case "pt":
    case "pt-br":
    case "pt_br":
      return "portugues";
    case "en":
    case "en-us":
    case "en-gb":
      return "ingles";
    case "es":
      return "espanhol";
    case "fr":
      return "frances";
    case "de":
      return "alemao";
    case "it":
      return "italiano";
    case "ja":
      return "japones";
    case "zh":
      return "chines";
    case "ru":
      return "russo";
    case "ar":
      return "arabe";
    case "hi":
      return "hindi";
    default:
      return "o mesmo idioma da transcricao";
  }
}

function systemPrompt(config: LocalAnalyzeConfig): string {
  const themes = config.themes.length > 0 ? config.themes : DEFAULT_THEMES;
  return SYSTEM_PROMPT.replace("{themes}", themes.join(", "))
    .replace("{author}", AUTHOR_UNKNOWN)
    .replace("{language}", languageName(config.language));
}

/** [mm:ss] de um deslocamento em milissegundos, o formato que o prompt le. */
function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Fala da nota, um trecho por linha com o tempo na frente.
 *
 * A revisao, quando existe, e o texto que o dono le; os tempos vem do trecho
 * original. Sem segmentos, o texto corrido e o que sobra.
 */
function transcriptBlock(transcript: Transcript | null): string {
  if (!transcript) return "";
  const linhas = (transcript.segments ?? [])
    .map((segment: Segment) => ({
      start: segment.start_ms ?? 0,
      text: (segment.revised?.trim() || segment.text || "").trim(),
    }))
    .filter((segment) => segment.text !== "")
    .map((segment) => `[${clock(segment.start)}] ${segment.text}`);
  if (linhas.length > 0) return linhas.join("\n");
  return (transcript.text ?? "").trim();
}

/** Texto escrito da nota seguido da transcricao, separados por linha em branco. */
async function noteText(entryId: string): Promise<string> {
  const notes = await listNotes(entryId);
  const escrito = notes
    .map((note) => (note.content_markdown ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
  const falado = transcriptBlock(await transcriptOf(entryId));
  return [escrito, falado].filter(Boolean).join("\n\n");
}

/** Resposta minima de /chat/completions que a analise consome. */
interface ChatCompletion {
  choices?: { message?: { content?: unknown } }[];
}

/** Tira a cerca ``` e o texto em volta; devolve o objeto JSON ou null. */
function jsonObjectOf(content: string): Record<string, unknown> | null {
  let text = content.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```[A-Za-z0-9_-]*\s*/, "");
    if (text.endsWith("```")) text = text.slice(0, -3);
    text = text.trim();
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Numero tolerante: o modelo as vezes manda "0.4" em vez de 0.4. */
function toNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Lista de objetos; item de outro tipo e ignorado. */
function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

/** Lista de textos curtos, sem itens vazios ou de outro tipo. */
function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function sentimentLabel(score: number): string {
  if (score <= -0.15) return "negativo";
  if (score >= 0.15) return "positivo";
  return "neutro";
}

interface ParsedAnalysis {
  sentiment: number;
  sentimentLabel: string;
  emotions: Record<string, number>;
  emotionsDetail: AnalysisEmotion[];
  people: string[];
  peopleDetail: AnalysisPerson[];
  places: string[];
  placesDetail: AnalysisPlace[];
  themes: AnalysisTheme[];
  summary: string;
  reading: string;
  keyMoments: KeyMoment[];
  questions: string[];
  decisions: string[];
  tasks: string[];
  ideas: string[];
  events: string[];
  epiphanies: string[];
  comprehension: number;
}

/** Monta o documento da web a partir do JSON do provedor, tolerando ausencias. */
function parseAnalysis(root: Record<string, unknown>): ParsedAnalysis {
  const sentimentRoot = isRecord(root.sentiment) ? root.sentiment : {};
  const sentiment = clamp(toNumber(sentimentRoot.score, 0), -1, 1);
  const informado = toText(sentimentRoot.label);
  const label =
    informado === "positivo" || informado === "neutro" || informado === "negativo"
      ? informado
      : sentimentLabel(sentiment);

  const emotions: Record<string, number> = {};
  const emotionsDetail: AnalysisEmotion[] = [];
  for (const item of records(root.emotions)) {
    const name = toText(item.name);
    if (!name || name in emotions) continue;
    const intensity = clamp(toNumber(item.intensity, 0), 0, 1);
    emotions[name] = intensity;
    emotionsDetail.push({ name, intensity });
  }

  const peopleDetail: AnalysisPerson[] = [];
  for (const item of records(root.people)) {
    const name = toText(item.name);
    if (!name || peopleDetail.some((person) => person.name === name)) continue;
    peopleDetail.push({
      name,
      count: Math.max(0, Math.round(toNumber(item.count, 1))),
      relation: toText(item.relation),
      sentiment: clamp(toNumber(item.sentiment, 0), -1, 1),
    });
  }

  const placesDetail: AnalysisPlace[] = [];
  for (const item of records(root.places)) {
    const name = toText(item.name);
    if (!name || placesDetail.some((place) => place.name === name)) continue;
    placesDetail.push({
      name,
      count: Math.max(0, Math.round(toNumber(item.count, 1))),
    });
  }

  const themes: AnalysisTheme[] = [];
  for (const item of records(root.themes)) {
    const name = toText(item.name);
    if (!name || themes.some((theme) => theme.name === name)) continue;
    themes.push({ name, confidence: clamp(toNumber(item.confidence, 0), 0, 1) });
  }

  const keyMoments: KeyMoment[] = [];
  for (const item of records(root.key_moments)) {
    const text = toText(item.text);
    if (!text) continue;
    keyMoments.push({
      start_ms: Math.max(0, Math.round(toNumber(item.start_ms, 0))),
      text,
    });
  }

  return {
    sentiment,
    sentimentLabel: label,
    emotions,
    emotionsDetail,
    people: peopleDetail.map((person) => person.name),
    peopleDetail,
    places: placesDetail.map((place) => place.name),
    placesDetail,
    themes,
    summary: toText(root.summary),
    reading: toText(root.reading),
    keyMoments,
    questions: strings(root.questions),
    decisions: strings(root.decisions),
    tasks: strings(root.tasks),
    ideas: strings(root.ideas),
    events: strings(root.events),
    epiphanies: strings(root.epiphanies),
    // O servidor usa -1 quando o modelo nao mediu a compreensao.
    comprehension: Math.round(clamp(toNumber(root.comprehension, -1), -1, 100)),
  };
}

/** Sinal de timeout; o jsdom antigo nao tem `AbortSignal.timeout`. */
function timeoutSignal(): { signal?: AbortSignal; done: () => void } {
  const globalSignal = AbortSignal as typeof AbortSignal & {
    timeout?: (ms: number) => AbortSignal;
  };
  const timeout = globalSignal.timeout;
  if (typeof timeout === "function") {
    return { signal: timeout(TIMEOUT_MS), done: () => undefined };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  (timer as unknown as { unref?: () => void }).unref?.();
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

function analysisKey(entryId: string): string {
  return `analysis:${entryId}`;
}

export interface LocalAnalyzeOptions {
  /** Injetavel nos testes; por padrao o `fetch` do navegador. */
  fetchImpl?: typeof fetch;
  /** Injetavel nos testes; por padrao le a configuracao do cofre. */
  config?: LocalAnalyzeConfig;
}

/**
 * Analisa a nota no provedor configurado e grava o resultado no cofre.
 *
 * Devolve o mesmo `Analysis` que a ficha desenha, com `origin: "api"`: a nota
 * nao perde a procedencia do texto que a produziu.
 */
export async function analyzeEntryLocally(
  entryId: string,
  options: LocalAnalyzeOptions = {},
): Promise<Analysis> {
  const entry = await getEntry(entryId);
  const text = await noteText(entryId);
  if (!text) {
    throw new Error("Esta nota ainda nao tem texto para analisar.");
  }

  const config = options.config ?? (await loadAnalyzeConfig());
  const provider = config.provider.trim().toLowerCase();
  if (TRANSCRIBE_ONLY.has(provider)) {
    throw new Error("Este provedor so transcreve audio. Escolha um provedor de analise em Configuracoes.");
  }
  if (!provider || !config.apiKey.trim() || !config.baseUrl.trim()) {
    throw new Error("Sem provedor de analise. Escolha o provedor e salve a chave em Configuracoes.");
  }

  // Sem barra final duplicada: o endpoint e sempre /chat/completions.
  const baseUrl = config.baseUrl.trim().replace(/\/+$/, "");
  const url = `${baseUrl}/chat/completions`;
  const modelo = config.model.trim() || PROVIDER_PRESETS[providerFromSettings(provider, baseUrl, "")]?.model || "";
  const corpo = {
    model: modelo,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt(config) },
      {
        role: "user",
        content: entry?.title ? `${entry.title}\n\n${text}` : text,
      },
    ],
  };

  const enviar = options.fetchImpl ?? fetch;
  const timeout = timeoutSignal();
  let resposta: Response;
  try {
    resposta = await enviar(url, {
      method: "POST",
      headers: {
        // A chave so vai no cabecalho: nunca na URL, nunca na mensagem de erro.
        Authorization: `Bearer ${config.apiKey.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(corpo),
      signal: timeout.signal,
    });
  } catch (error) {
    const name =
      isRecord(error) && typeof error.name === "string" ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new Error("O provedor nao respondeu a tempo.", { cause: error });
    }
    throw error;
  } finally {
    timeout.done();
  }

  // O corpo pode ecoar a requisicao (e a chave); so o numero e seguro.
  if (!resposta.ok) {
    throw new Error(`O provedor recusou a analise (${resposta.status}).`);
  }

  const completacao = (await resposta.json()) as ChatCompletion;
  const conteudo = completacao.choices?.[0]?.message?.content;
  const root = typeof conteudo === "string" ? jsonObjectOf(conteudo) : null;
  if (!root) {
    throw new Error("O provedor respondeu em um formato inesperado.");
  }

  const parsed = parseAnalysis(root);
  const analysis: Analysis = {
    origin: "api",
    model: modelo,
    sentiment: parsed.sentiment,
    sentiment_label: parsed.sentimentLabel,
    emotions: parsed.emotions,
    people: parsed.people,
    places: parsed.places,
    summary: parsed.summary,
    emotions_detail: parsed.emotionsDetail,
    people_detail: parsed.peopleDetail,
    places_detail: parsed.placesDetail,
    themes: parsed.themes,
    reading: parsed.reading,
    key_moments: parsed.keyMoments,
    questions: parsed.questions,
    decisions: parsed.decisions,
    tasks: parsed.tasks,
    ideas: parsed.ideas,
    events: parsed.events,
    epiphanies: parsed.epiphanies,
    sentence_source: "model",
    comprehension: parsed.comprehension,
  };

  await storeSet(ANALYSIS_STORE, analysisKey(entryId), analysis);
  return analysis;
}

/** Analise ja gravada no cofre; null quando a nota ainda nao foi analisada. */
export async function readLocalAnalysis(entryId: string): Promise<Analysis | null> {
  return (await storeGet<Analysis>(ANALYSIS_STORE, analysisKey(entryId))) ?? null;
}

/** Apaga a analise guardada, para a proxima chamada refazer do zero. */
export async function clearLocalAnalysis(entryId: string): Promise<void> {
  await storeDelete(ANALYSIS_STORE, analysisKey(entryId));
}
