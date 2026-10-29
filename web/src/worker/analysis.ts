/**
 * Leitura de uma nota no navegador, com o mesmo contrato do app.
 *
 * O nucleo puro (plano de blocos, prompt, parser, ancoragem, composicao) vive em
 * `mobile/src/core` e e importado aqui sem copia: as duas superficies leem a
 * mesma nota com as mesmas regras. O que muda e so quem gera os tokens.
 */

import { planAnalysis, type AnalysisBlock } from "../../../mobile/src/core/analysisPlan";
import {
  CHUNK_PROMPT_VERSION,
  CHUNK_SCHEMA,
  buildChunkMessages,
  contentWordList,
  groundChunk,
  parseChunkJson,
  type ChunkExtraction,
} from "../../../mobile/src/core/analysisChunk";
import {
  composeAnalysis,
  type AnalysisChunkFact,
  type ComposedAnalysis,
} from "../../../mobile/src/core/analysisCompose";
import { toServerAnalysis } from "../../../mobile/src/core/analysis";
import {
  SUMMARY_SCHEMA,
  acceptSummary,
  buildSummaryMessages,
  derivedSentence,
  parseSummaryJson,
  summaryDigest,
} from "../../../mobile/src/core/analysisSummary";
import { ANALYSIS_STORE, storeGet, storeSet } from "../lib/idb";

export interface WorkerSegment {
  start_ms: number;
  end_ms: number;
  text: string;
  revised?: string;
}

/** Tudo o que o worker precisa para ler uma nota, vindo da API. */
export interface WorkerNote {
  entryId: string;
  title: string;
  /** Corpo escrito em markdown. */
  text: string;
  transcript: string;
  segments: WorkerSegment[];
  author?: string;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmGeneration {
  text: string;
  promptTokens: number;
  completionTokens: number;
  wallMs: number;
}

/** Uma chamada ao modelo escolhido (wllama no navegador). */
export type LlmGenerate = (input: {
  messages: LlmMessage[];
  schema: Record<string, unknown>;
  maxTokens: number;
}) => Promise<LlmGeneration>;

export type AnalysisStage = "preparing" | "reading" | "sentence" | "done";

export interface AnalysisProgress {
  stage: AnalysisStage;
  read: number;
  total: number;
  blockIndex: number;
  tokens: number;
  tokensPerSecond: number;
}

export interface BlockDebug {
  blockIndex: number;
  /** Texto bruto devolvido pelo modelo, so para o laboratorio local. */
  raw: string;
  parsed: boolean;
  items: number;
  dropped: number;
}

export interface WorkerAnalysis {
  /** Corpo pronto para PUT /entries/{id}/analysis. */
  payload: Record<string, unknown>;
  doc: ComposedAnalysis;
  /** Mostras locais dos blocos que vieram vazios ou ilegiveis. */
  debug: BlockDebug[];
  blocks: number;
  readNow: number;
  rejected: number;
  dropped: number;
  promptTokens: number;
  completionTokens: number;
  tokensPerSecond: number;
  wallMs: number;
}

interface CachedChunk {
  /** "rejected" is a block that failed; it must be retried next time. */
  status: "ok" | "rejected";
  extraction: ChunkExtraction;
  dropped: number;
}

function chunkKey(entryId: string, modelId: string, block: AnalysisBlock): string {
  return `${entryId}|${modelId}|${CHUNK_PROMPT_VERSION}|${block.index}|${block.hash}`;
}

async function readCached(
  entryId: string,
  modelId: string,
  block: AnalysisBlock,
): Promise<CachedChunk | null> {
  const cached = await storeGet<CachedChunk>(ANALYSIS_STORE, chunkKey(entryId, modelId, block));
  return cached && cached.status === "ok" && cached.extraction ? cached : null;
}

async function writeCached(
  entryId: string,
  modelId: string,
  block: AnalysisBlock,
  chunk: CachedChunk,
): Promise<void> {
  await storeSet(ANALYSIS_STORE, chunkKey(entryId, modelId, block), chunk);
}

function emptyExtraction(): ChunkExtraction {
  return {
    tone: 0,
    emotions: [],
    themes: [],
    people: [],
    places: [],
    events: [],
    decisions: [],
    tasks: [],
    ideas: [],
    epiphanies: [],
    moments: [],
  };
}

function hasItems(extraction: ChunkExtraction): boolean {
  return (
    extraction.people.length > 0 ||
    extraction.places.length > 0 ||
    extraction.emotions.length > 0 ||
    extraction.themes.length > 0 ||
    extraction.events.length > 0 ||
    extraction.decisions.length > 0 ||
    extraction.tasks.length > 0 ||
    extraction.ideas.length > 0 ||
    extraction.epiphanies.length > 0 ||
    extraction.moments.length > 0
  );
}

function noteForPlan(note: WorkerNote) {
  return {
    text: note.text,
    transcript: note.transcript,
    transcriptSegments: note.segments.map((segment) => ({
      start_ms: segment.start_ms,
      end_ms: segment.end_ms,
      text: segment.text,
      revised: segment.revised ?? "",
    })),
  };
}

/**
 * Le uma nota inteira. Cada bloco tem cache local (modelo + hash + versao do
 * prompt): fechar a aba no meio nao joga fora o que ja foi lido. Blocos vazios
 * ainda tentam o prompt curto, como no app, porque e o que salva um modelo
 * pequeno.
 */
export async function analyzeNoteInBrowser(
  note: WorkerNote,
  modelId: string,
  generate: LlmGenerate,
  options: {
    onProgress?: (progress: AnalysisProgress) => void;
    /** Devolve true para parar antes do proximo bloco. */
    shouldStop?: () => boolean;
  } = {},
): Promise<WorkerAnalysis> {
  const startedAt = Date.now();
  const plan = planAnalysis(noteForPlan(note));
  const total = plan.blocks.length;
  const facts: AnalysisChunkFact[] = [];
  let promptTokens = 0;
  let completionTokens = 0;
  let predictedMs = 0;
  let readNow = 0;
  let rejected = 0;
  let dropped = 0;
  const debug: BlockDebug[] = [];

  const report = (stage: AnalysisStage, blockIndex: number) => {
    options.onProgress?.({
      stage,
      read: facts.length,
      total,
      blockIndex,
      tokens: completionTokens,
      tokensPerSecond: predictedMs > 0 ? (completionTokens * 1000) / predictedMs : 0,
    });
  };

  for (const block of plan.blocks) {
    if (options.shouldStop?.()) break;
    const cached = await readCached(note.entryId, modelId, block);
    if (cached) {
      facts.push({ block, extraction: cached.extraction });
      dropped += cached.dropped;
      report("reading", block.index);
      continue;
    }

    let accepted: { extraction: ChunkExtraction; dropped: number } | null = null;
    let lastRaw = "";
    let lastParsed = false;
    const attempts: { maxTokens: number; compact: boolean }[] = [
      { maxTokens: 260, compact: false },
      { maxTokens: 380, compact: false },
    ];
    if (contentWordList(block.text).length >= 12) {
      attempts.push({ maxTokens: 380, compact: true });
    }
    for (const attempt of attempts) {
      if (options.shouldStop?.()) break;
      // Avisa antes de gerar: numa maquina lenta o primeiro token demora, e sem
      // isto o painel fica em "iniciando" sem dizer em que bloco esta.
      report("reading", block.index);
      const attemptStarted = Date.now();
      try {
        const run = await generate({
          messages: buildChunkMessages(
            { title: note.title, block: { text: block.text, context: block.context } },
            { compact: attempt.compact },
          ),
          schema: CHUNK_SCHEMA as unknown as Record<string, unknown>,
          maxTokens: attempt.maxTokens,
        });
        promptTokens += run.promptTokens;
        completionTokens += run.completionTokens;
        predictedMs += run.wallMs;
        lastRaw = run.text.slice(0, 1200);
        const parsed = parseChunkJson(run.text);
        lastParsed = Boolean(parsed);
        if (!parsed) continue;
        const grounded = groundChunk(parsed, block.text);
        accepted = { extraction: grounded.extraction, dropped: grounded.dropped };
        if (hasItems(grounded.extraction)) break;
        // Uma tentativa lenta ja disse o que tinha a dizer; repetir triplicaria
        // a espera numa maquina fraca.
        if (Date.now() - attemptStarted > 60_000) break;
      } catch {
        // Um bloco pode falhar sem derrubar a nota: o documento sai parcial e a
        // cobertura mostra quantos blocos foram lidos.
        break;
      }
    }

    if (!accepted || !hasItems(accepted.extraction)) {
      debug.push({
        blockIndex: block.index,
        raw: lastRaw,
        parsed: lastParsed,
        items: accepted
          ? accepted.extraction.people.length +
            accepted.extraction.places.length +
            accepted.extraction.emotions.length +
            accepted.extraction.themes.length +
            accepted.extraction.events.length +
            accepted.extraction.decisions.length +
            accepted.extraction.tasks.length +
            accepted.extraction.ideas.length +
            accepted.extraction.epiphanies.length +
            accepted.extraction.moments.length
          : 0,
        dropped: accepted?.dropped ?? 0,
      });
    }
    if (accepted) {
      facts.push({ block, extraction: accepted.extraction });
      readNow += 1;
      dropped += accepted.dropped;
      await writeCached(note.entryId, modelId, block, { status: "ok", ...accepted });
    } else {
      rejected += 1;
      // Nao gravar como lido: a proxima passada tenta de novo.
      await writeCached(note.entryId, modelId, block, {
        status: "rejected",
        extraction: emptyExtraction(),
        dropped: 0,
      });
    }
    report("reading", block.index);
  }

  let doc = composeAnalysis({ blocks: plan.blocks, facts, model: modelId });
  if (doc.blocksTotal > 0 && doc.blocksRead === doc.blocksTotal && !options.shouldStop?.()) {
    report("sentence", total - 1);
    const digest = summaryDigest(doc, plan.blocks, {
      title: note.title,
      author: note.author ?? "",
    });
    try {
      const run = await generate({
        messages: buildSummaryMessages({ digest }),
        schema: SUMMARY_SCHEMA as unknown as Record<string, unknown>,
        maxTokens: 120,
      });
      promptTokens += run.promptTokens;
      completionTokens += run.completionTokens;
      predictedMs += run.wallMs;
      const source = [digest.trecho, ...digest.momentos.map((moment) => moment.texto)].join(" ");
      const sentence = parseSummaryJson(run.text);
      doc = acceptSummary(sentence ?? "", source, digest) && sentence
        ? { ...doc, sentence, sentenceSource: "model" }
        : { ...doc, sentence: derivedSentence(doc), sentenceSource: "derived" };
    } catch {
      doc = { ...doc, sentence: derivedSentence(doc), sentenceSource: "derived" };
    }
  } else if (doc.sentence === "") {
    doc = { ...doc, sentence: derivedSentence(doc), sentenceSource: "derived" };
  }

  report("done", total - 1);
  const payload = {
    ...toServerAnalysis(doc, modelId),
    origin: "browser",
  } as unknown as Record<string, unknown>;
  return {
    payload,
    doc,
    debug: debug.slice(0, 3),
    blocks: total,
    readNow,
    rejected,
    dropped,
    promptTokens,
    completionTokens,
    tokensPerSecond: predictedMs > 0 ? (completionTokens * 1000) / predictedMs : 0,
    wallMs: Date.now() - startedAt,
  };
}
