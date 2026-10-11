/**
 * Importacao de audios compartilhados por outros apps (Android). Este modulo e
 * puro: recebe os metadados que o expo-sharing entrega e decide titulo, data,
 * formato e nome de upload. Nada de IO aqui, para testar com fakes.
 *
 * A whitelist de formatos espelha a do servidor (DIARY_ALLOWED_FORMATS): um
 * formato fora dela e bloqueado na revisao em vez de virar item que vai falhar.
 */

import type { Recording } from './types';

export interface ShareAudioPayload {
  /** URI local legivel do conteudo compartilhado. */
  uri: string;
  /** MIME informado pelo app de origem, quando houver. */
  mimeType?: string | null;
  /** Nome sugerido do arquivo (ex.: "12/25/2025 10:30 AM.m4a"). */
  name?: string | null;
  /** Tamanho em bytes, quando informado. */
  size?: number | null;
}

export interface ShareAudioAnalysis {
  /** Nome original informado pelo app de origem. */
  originalName: string;
  /** Formato aceito pela whitelist do servidor? */
  supported: boolean;
  /** Motivo (pt-BR, generico) quando nao suportado. */
  reason?: string;
  /** Extensao sem ponto, quando suportado. */
  extension?: string;
  /** Content-Type usado no upload. */
  contentType?: string;
  /** Titulo exibido/editavel, derivado do nome do arquivo. */
  title: string;
  /** Inicio do audio em ISO 8601 UTC. */
  recordedAt: string;
  /** Data extraida do nome (dia/mes/hora, talvez sem ano), para a revisao ajustar. */
  date?: NameDate;
  /** Data de modificacao do arquivo, usada como fallback. */
  fallbackMs?: number;
}

/** Data extraida do nome do arquivo, antes de decidir o ano/ordem. */
export interface NameDate {
  /** Primeiro componente numerico (na ordem do nome). */
  a: number;
  /** Segundo componente numerico. */
  b: number;
  /** Ano, quando presente no nome. */
  year?: number;
  hour: number;
  minute: number;
  second: number;
  /** Ordem detectada; 'unknown' quando dia e mes sao ambos <= 12. */
  order: 'day-first' | 'month-first' | 'unknown';
}

/** Limite de audios aceitos por compartilhamento (o Android nao limita isto). */
export const MAX_SHARED_FILES = 50;

const SUPPORTED_EXTENSIONS = ['wav', 'mp3', 'm4a', 'ogg', 'flac', 'aac', 'adts'];

const MIME_BY_EXTENSION: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
  adts: 'audio/aac',
};

const EXTENSION_BY_MIME: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/vnd.wave': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/x-mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/ogg': 'ogg',
  'audio/vorbis': 'ogg',
  'audio/x-ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/aac': 'aac',
  'audio/x-aac': 'aac',
  'audio/aacp': 'aac',
  'audio/adts': 'aac',
};

function fileNameOf(payload: ShareAudioPayload): string {
  const name = (payload.name ?? '').trim();
  if (name) return name;
  return (payload.uri ?? '').trim();
}

function baseNameOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return base.trim();
  return base.slice(0, dot).trim();
}

function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

function normalizeMime(mime: string | null | undefined): string {
  return (mime ?? '').toLowerCase().split(';')[0].trim();
}

function isSupportedExtension(extension: string): boolean {
  return SUPPORTED_EXTENSIONS.includes(extension);
}

/** Extensao sem ponto aceita pelo servidor, ou null quando nao suportado. */
export function extensionFor(payload: ShareAudioPayload): string | null {
  const name = fileNameOf(payload);
  const byName = extensionOf(name);
  if (isSupportedExtension(byName)) return byName;

  const byMime = EXTENSION_BY_MIME[normalizeMime(payload.mimeType)];
  if (byMime) return byMime;

  const byUri = extensionOf(payload.uri);
  if (isSupportedExtension(byUri)) return byUri;

  return null;
}

/** Content-Type padrao de uma extensao aceita. */
export function mimeForExtension(extension: string): string {
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

/**
 * Converte um nome de arquivo com data no formato americano (mes/dia/ano) para
 * uma data. So converte quando for inequivoco; nomes ambiguos (dia e mes ambos
 * <= 12) devolvem null e o usuario ajusta na revisao.
 */
export function parseUsDateTime(text: string): Date | null {
  const match = text.match(
    /(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AaPp])\.?[Mm]\.?)?)?/,
  );
  if (!match) return null;

  const a = match[1];
  const b = match[2];
  const c = match[3];
  let year: number;
  let month: number;
  let day: number;

  if (a.length === 4) {
    // Ano na frente (ex.: 2025-12-25): sem ambiguidade.
    year = Number(a);
    month = Number(b);
    day = Number(c);
    if (c.length === 4) return null;
  } else if (c.length === 4) {
    const first = Number(a);
    const second = Number(b);
    if (first > 12 && second <= 12) {
      // Dia primeiro (fora dos EUA): ja esta no formato brasileiro.
      day = first;
      month = second;
    } else if (second > 12 && first <= 12) {
      // Mes/dia (americano).
      month = first;
      day = second;
    } else {
      // Ambiguo: nao adivinha.
      return null;
    }
    year = Number(c);
  } else {
    return null;
  }

  let hour = match[4] ? Number(match[4]) : 0;
  const minute = match[5] ? Number(match[5]) : 0;
  const second = match[6] ? Number(match[6]) : 0;
  const meridiem = match[7] ? match[7].toLowerCase() : '';
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'p' && hour !== 12) hour += 12;
    if (meridiem === 'a' && hour === 12) hour = 0;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  const date = new Date(year, month - 1, day, hour, minute, second, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function normalizeYear(value: number): number {
  return value < 100 ? 2000 + value : value;
}

/**
 * Extrai a data do nome do arquivo, com ou sem ano. Detecta a ordem quando e
 * inequivoca (um componente > 12); quando dia e mes sao ambos <= 12, a ordem e
 * 'unknown' e a revisao usa um padrao (dia primeiro) com opcao de inverter.
 */
export function parseNameDate(name: string): NameDate | null {
  const match = name.match(
    /(\d{1,4})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AaPp])\.?[Mm]\.?)?)?/,
  );
  if (!match) return null;

  const g1 = match[1];
  const g2 = match[2];
  const g3 = match[3];
  let a: number;
  let b: number;
  let year: number | undefined;
  let order: NameDate['order'];

  if (g1.length === 4) {
    // ISO: AAAA-MM-DD
    year = Number(g1);
    a = Number(g2);
    b = g3 ? Number(g3) : 1;
    order = 'month-first';
  } else {
    a = Number(g1);
    b = Number(g2);
    year = g3 ? normalizeYear(Number(g3)) : undefined;
    if (a > 12 && b <= 12) order = 'day-first';
    else if (b > 12 && a <= 12) order = 'month-first';
    else order = 'unknown';
  }

  let hour = match[4] ? Number(match[4]) : 0;
  const minute = match[5] ? Number(match[5]) : 0;
  const second = match[6] ? Number(match[6]) : 0;
  const meridiem = match[7] ? match[7].toLowerCase() : '';
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'p' && hour !== 12) hour += 12;
    if (meridiem === 'a' && hour === 12) hour = 0;
  }

  return { a, b, year, hour, minute, second, order };
}

/**
 * Resolve a data do evento a partir do que foi extraido do nome, aplicando o ano
 * escolhido (quando o nome nao tem ano) e a opcao de inverter dia/mes. Sem data
 * no nome, usa o fallback (data de modificacao do arquivo ou agora).
 */
export function resolveRecordedAt(
  date: NameDate | null,
  opts: { year: number; invert: boolean; fallback: Date },
): Date {
  if (!date) return opts.fallback;
  // Padrao quando ambiguo: dia primeiro (pt-BR); o usuario pode inverter.
  let dayFirst = date.order !== 'month-first';
  if (opts.invert) dayFirst = !dayFirst;
  const day = dayFirst ? date.a : date.b;
  const month = dayFirst ? date.b : date.a;
  const year = date.year ?? opts.year;
  if (month < 1 || month > 12 || day < 1 || day > 31) return opts.fallback;
  const result = new Date(year, month - 1, day, date.hour, date.minute, date.second, 0);
  if (
    result.getFullYear() !== year ||
    result.getMonth() !== month - 1 ||
    result.getDate() !== day
  ) {
    return opts.fallback;
  }
  return result;
}

/** Formata uma data como "DD/MM/AAAA HH:mm" (24h) ou "DD/MM/AAAA hh:mm AM". */
export function formatBrDateTime(date: Date, use24h = true): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  const datePart = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
  if (use24h) {
    return `${datePart} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  const hours = date.getHours();
  const meridiem = hours < 12 ? 'AM' : 'PM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${datePart} ${pad(hour12)}:${pad(date.getMinutes())} ${meridiem}`;
}

/** Interpreta "DD/MM/AAAA HH:mm" (24h ou com AM/PM; hora opcional). */
export function parseBrDateTime(text: string): Date | null {
  const match = text
    .trim()
    .match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AaPp])\.?[Mm]\.?)?)?$/,
    );
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  let hour = match[4] ? Number(match[4]) : 0;
  const minute = match[5] ? Number(match[5]) : 0;
  const second = match[6] ? Number(match[6]) : 0;
  const meridiem = match[7] ? match[7].toLowerCase() : '';
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'p' && hour !== 12) hour += 12;
    if (meridiem === 'a' && hour === 12) hour = 0;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const date = new Date(year, month - 1, day, hour, minute, second, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

/** Nome de arquivo seguro para upload, terminando na extensao aceita. */
export function buildShareFileName(title: string, extension: string): string {
  const safe = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ._-]+/g, '')
    .trim()
    .replace(/\s+/g, ' ');
  const base = safe.length > 0 ? safe.slice(0, 80) : 'audio';
  return `${base}.${extension}`;
}

/** Analisa um payload do expo-sharing sem tocar em disco. */
export function analyzeShareAudio(
  payload: ShareAudioPayload,
  opts: { now: Date; lastModifiedMs?: number | null; year?: number; invert?: boolean },
): ShareAudioAnalysis {
  const originalName = fileNameOf(payload) || 'Audio';
  const title = baseNameOf(originalName) || 'Audio';
  const date = parseNameDate(originalName);
  const fallback =
    typeof opts.lastModifiedMs === 'number' && opts.lastModifiedMs > 0
      ? new Date(opts.lastModifiedMs)
      : opts.now;
  const recordedAt = resolveRecordedAt(date, {
    year: opts.year ?? opts.now.getFullYear(),
    invert: opts.invert ?? false,
    fallback,
  }).toISOString();
  const extension = extensionFor(payload);
  const base = {
    originalName,
    title,
    recordedAt,
    date: date ?? undefined,
    fallbackMs: opts.lastModifiedMs ?? undefined,
  };

  if (!extension) {
    return { ...base, supported: false, reason: 'Formato de audio nao suportado.' };
  }

  const mime = normalizeMime(payload.mimeType);
  const contentType = mime.startsWith('audio/') ? mime : mimeForExtension(extension);
  return { ...base, supported: true, extension, contentType };
}

/**
 * Rascunho de importacao exibido na tela de revisao. So vira `Recording` (e vai
 * para a fila) depois da confirmacao do usuario.
 */
export interface ImportDraft {
  /** Chave estavel para a lista. */
  key: string;
  title: string;
  recordedAt: string;
  originalName: string;
  supported: boolean;
  reason?: string;
  contentType?: string;
  extension?: string;
  sizeBytes?: number;
  durationMs?: number;
  /** Data extraida do nome (para a revisao aplicar ano/ordem). */
  date?: NameDate;
  /** Data de modificacao do arquivo (fallback). */
  fallbackMs?: number;
  /** Preenchidos quando o arquivo ja foi copiado para o storage do app. */
  id?: string;
  dir?: string;
  filePath?: string;
  fileName?: string;
}

/** Converte um rascunho suportado no `Recording` que entra na fila. */
export function draftToRecording(draft: ImportDraft, now: Date): Recording {
  if (!draft.supported || !draft.id || !draft.dir || !draft.filePath || !draft.fileName) {
    throw new Error('rascunho de importacao incompleto');
  }
  const iso = now.toISOString();
  return {
    id: draft.id,
    title: draft.title,
    recordedAt: draft.recordedAt,
    dir: draft.dir,
    filePath: draft.filePath,
    segmentCount: 0,
    durationMs: draft.durationMs,
    sizeBytes: draft.sizeBytes,
    status: 'recorded',
    offset: 0,
    attempts: 0,
    contentType: draft.contentType,
    fileName: draft.fileName,
    source: 'share',
    createdAt: iso,
    updatedAt: iso,
  };
}
