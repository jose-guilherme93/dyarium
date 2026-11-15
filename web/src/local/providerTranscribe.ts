/**
 * Transcricao por provedor no navegador (Deepgram).
 *
 * O runtime ONNX nao cabe no build hospedado, entao ali a transcricao acontece
 * na API: o audio sai do cofre local e vai para a Deepgram com a chave que o
 * usuario salvou em Configuracoes. O resultado entra na nota pelo mesmo caminho
 * da transcricao local, mudando so a origem (`provider`).
 *
 * A chave nunca aparece em mensagem, URL ou log: erro ao usuario cita apenas o
 * status numerico da resposta.
 */

import { getRecording, upsertRecording } from "../../../mobile/src/core/repo";
import type { TranscriptSegment } from "../../../mobile/src/core/types";

import type { Segment, Transcript } from "../types";

import { audioBlobOf } from "./audio";
import { loadTranscribeConfig, type TranscribeConfig } from "./settings";

export interface ProviderTranscribeOptions {
  /** Idioma pedido a API; padrao: o do cofre. */
  language?: string;
  /** Modelo pedido a API; padrao: o do cofre ou "nova-2". */
  model?: string;
  /** Injetavel nos testes; por padrao o `fetch` do navegador. */
  fetchImpl?: typeof fetch;
  /** Injetavel nos testes; por padrao le a configuracao do cofre. */
  config?: TranscribeConfig;
}

const ENDPOINT = "https://api.deepgram.com/v1/listen";
const MODELO_PADRAO = "nova-2";
/** Pausa entre palavras que vira fronteira de trecho quando nao ha utterances. */
const PAUSA_MS = 800;

interface DeepgramWord {
  word?: string;
  punctuated_word?: string;
  start?: number;
  end?: number;
}

interface DeepgramUtterance {
  transcript?: string;
  start?: number;
  end?: number;
}

interface DeepgramAlternative {
  transcript?: string;
  words?: DeepgramWord[];
}

interface DeepgramResponse {
  results?: {
    utterances?: DeepgramUtterance[];
    channels?: { alternatives?: DeepgramAlternative[] }[];
  };
}

/** Um trecho por utterance; os tempos vem em segundos e viram ms. */
function segmentosDasUtterances(utterances: DeepgramUtterance[]): Segment[] {
  const segmentos: Segment[] = [];
  for (const utterance of utterances) {
    const texto = (utterance.transcript ?? "").trim();
    if (!texto) continue;
    const inicio = utterance.start ?? 0;
    segmentos.push({
      idx: segmentos.length,
      start_ms: Math.round(inicio * 1000),
      end_ms: Math.round((utterance.end ?? inicio) * 1000),
      text: texto,
    });
  }
  return segmentos;
}

/** Sem utterances: agrupa as palavras e corta onde a fala fez uma pausa. */
function segmentosDasPalavras(words: DeepgramWord[]): Segment[] {
  const segmentos: Segment[] = [];
  let atual: { start: number; end: number; palavras: string[] } | null = null;

  const fechar = () => {
    if (!atual) return;
    segmentos.push({
      idx: segmentos.length,
      start_ms: Math.round(atual.start * 1000),
      end_ms: Math.round(atual.end * 1000),
      text: atual.palavras.join(" "),
    });
    atual = null;
  };

  for (const word of words) {
    const texto = (word.punctuated_word ?? word.word ?? "").trim();
    if (!texto) continue;
    const inicio: number = word.start ?? atual?.end ?? 0;
    const fim: number = word.end ?? inicio;
    if (atual && (inicio - atual.end) * 1000 > PAUSA_MS) fechar();
    if (!atual) atual = { start: inicio, end: fim, palavras: [] };
    atual.palavras.push(texto);
    atual.end = fim;
  }
  fechar();
  return segmentos;
}

/** Texto e trechos da resposta, na ordem de preferencia do contrato. */
function extrair(results: DeepgramResponse["results"]): { text: string; segments: Segment[] } {
  const dasUtterances = segmentosDasUtterances(results?.utterances ?? []);
  if (dasUtterances.length > 0) {
    return {
      text: dasUtterances.map((segmento) => segmento.text).join(" "),
      segments: dasUtterances,
    };
  }

  const alternativa = results?.channels?.[0]?.alternatives?.[0];
  const dasPalavras = segmentosDasPalavras(alternativa?.words ?? []);
  if (dasPalavras.length > 0) {
    const texto = (alternativa?.transcript ?? "").trim();
    return {
      text: texto || dasPalavras.map((segmento) => segmento.text).join(" "),
      segments: dasPalavras,
    };
  }

  // Sem palavras nem utterances: o texto inteiro num trecho so, sem tempo.
  const texto = (alternativa?.transcript ?? "").trim();
  return {
    text: texto,
    segments: texto ? [{ idx: 0, start_ms: 0, end_ms: 0, text: texto }] : [],
  };
}

/**
 * Transcreve o audio da nota na Deepgram e grava o resultado no cofre local.
 * Devolve o `Transcript` no formato que a web ja desenha.
 */
export async function transcribeWithProvider(
  entryId: string,
  options: ProviderTranscribeOptions = {},
): Promise<Transcript> {
  const blob = await audioBlobOf(entryId);
  if (!blob) throw new Error("esta nota nao tem audio");

  const config = options.config ?? (await loadTranscribeConfig());
  const apiKey = config.apiKey.trim();
  if (!apiKey) {
    throw new Error("Sem chave da Deepgram. Salve a chave em Configurações para transcrever.");
  }

  const model = options.model?.trim() || config.model.trim() || MODELO_PADRAO;
  const language = options.language?.trim() || config.language.trim() || "pt";

  // A chave vai no cabecalho; a URL so leva o que o servico precisa.
  const url = new URL(ENDPOINT);
  url.searchParams.set("model", model);
  url.searchParams.set("language", language);
  url.searchParams.set("smart_format", "true");
  url.searchParams.set("punctuate", "true");
  url.searchParams.set("utterances", "true");

  const enviar = options.fetchImpl ?? fetch;
  const resposta = await enviar(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": blob.type || "audio/wav",
    },
    body: blob,
  });

  // O corpo pode ecoar a requisicao (e a chave); so o numero e seguro.
  if (!resposta.ok) {
    throw new Error(`A Deepgram recusou a transcricao (${resposta.status}).`);
  }

  const corpo = (await resposta.json()) as DeepgramResponse;
  const { text, segments } = extrair(corpo.results);

  const recording = await getRecording(entryId);
  if (!recording) throw new Error("nota local nao encontrada");

  const transcriptSegments: TranscriptSegment[] = segments.map((segmento) => ({
    start_ms: segmento.start_ms,
    end_ms: segmento.end_ms,
    text: segmento.text,
  }));

  await upsertRecording({
    ...recording,
    transcript: text,
    transcriptSegments,
    transcriptStatus: "ready",
    transcriptOrigin: "provider",
    hasTranscript: true,
    transcriptLanguage: language,
    updatedAt: new Date().toISOString(),
  });

  const ultimo = segments.length > 0 ? segments[segments.length - 1].end_ms : 0;
  return {
    model,
    language,
    text,
    raw_text: text,
    trim_silence: false,
    duration_seconds: Math.round(ultimo / 1000),
    segments,
  };
}
