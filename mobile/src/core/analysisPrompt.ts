/**
 * Peças comuns da analise: hash de conteudo, leitura de JSON tolerante e
 * comparacao de texto. Puro e testavel.
 *
 * O contrato do bloco vive em `analysisChunk.ts`, a composicao em
 * `analysisCompose.ts` e a frase da nota em `analysisSummary.ts`.
 */

/** Limite da frase unica da nota. */
export const MAX_READING_CHARS = 200;

/** Minusculas, sem acento e sem pontuacao: so para comparar palavras. */
export function foldText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Uma palavra comparavel: minuscula, sem acento e sem pontuacao nas bordas. */
export function foldWord(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
}

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max).trimEnd() : trimmed;
}

/**
 * Hash estavel do conteudo analisado (titulo + corpo sem markdown +
 * transcricao). Serve para saber se a analise guardada ainda corresponde ao
 * texto atual da nota. Nao e criptografico; e so um identificador local.
 */
export function analysisContentHash(input: {
  title: string;
  text: string;
  transcript?: string;
}): string {
  const normalized = [
    clip(input.title ?? '', 120),
    foldText(input.text ?? ''),
    foldText(input.transcript ?? ''),
  ].join('\u0000');
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

/** A frase e praticamente uma copia do texto de origem? */
export function readingRepeatsInput(reading: string, input: string): boolean {
  const readingNorm = foldText(reading);
  const inputNorm = foldText(input);
  if (readingNorm.length < 20) return false;
  if (inputNorm.includes(readingNorm)) return true;
  const words = readingNorm.split(' ').filter((word) => word.length >= 4);
  if (words.length < 5) return false;
  const inputWords = new Set(inputNorm.split(' '));
  const overlap = words.filter((word) => inputWords.has(word)).length / words.length;
  return overlap >= 0.8;
}

/**
 * Fecha um JSON cortado no meio (modelo atingiu o limite de tokens ou parou
 * antes do fim). Completa string aberta, `null` em chave sem valor e os
 * colchetes/chaves pendentes. Nao tenta consertar estrutura errada.
 */
export function closeJsonPartial(input: string): string {
  let inString = false;
  let escaped = false;
  const stack: string[] = [];
  for (const char of input) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') stack.push('}');
    else if (char === '[') stack.push(']');
    else if (char === '}' || char === ']') stack.pop();
  }

  let out = input.trimEnd();
  if (inString) out += '"';
  out = out.replace(/[,\s]+$/, '');
  if (/:\s*$/.test(out)) out += 'null';
  for (let index = stack.length - 1; index >= 0; index -= 1) out += stack[index];
  return out;
}

/** Primeiro `{` ate o fim e, se houver texto depois, ate o ultimo `}`. */
export function jsonCandidates(raw: string): string[] {
  const withoutFence = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const start = withoutFence.indexOf('{');
  if (start < 0) return [];
  const fromStart = withoutFence.slice(start);
  const end = withoutFence.lastIndexOf('}');
  const candidates = [fromStart];
  if (end > start) candidates.push(withoutFence.slice(start, end + 1));
  return candidates;
}

export function parseJsonLoose(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    // modelo pode ter sido cortado no limite de tokens
  }
  try {
    return JSON.parse(closeJsonPartial(text));
  } catch {
    return null;
  }
}

/** Le o primeiro objeto JSON utilizavel da resposta do modelo. */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  for (const candidate of jsonCandidates(raw)) {
    const value = parseJsonLoose(candidate);
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return null;
}

export function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
