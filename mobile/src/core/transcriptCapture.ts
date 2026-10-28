/**
 * Transformar um trecho da transcricao em uma nota propria.
 *
 * Tudo que sai daqui vira uma nota no caderno "Tarefas e ideias", com a tag do
 * tipo escolhido: e a tag que deixa o tipo reconhecivel depois, na lista e na
 * busca. Puro e testavel.
 */

import type { TranscriptSegment } from './types';

export type CaptureKind = 'task' | 'idea' | 'quote';

export interface CaptureOption {
  kind: CaptureKind;
  label: string;
  tag: string;
  icon: 'checkbox-outline' | 'bulb-outline' | 'chatbox-ellipses-outline';
}

/** Caderno unico destas capturas, criado na primeira vez que o usuario usa. */
export const CAPTURE_NOTEBOOK = 'Tarefas e ideias';

export const CAPTURE_OPTIONS: CaptureOption[] = [
  { kind: 'task', label: 'Tarefa', tag: 'tarefa', icon: 'checkbox-outline' },
  { kind: 'idea', label: 'Ideia', tag: 'ideia', icon: 'bulb-outline' },
  { kind: 'quote', label: 'Citação', tag: 'citação', icon: 'chatbox-ellipses-outline' },
];

/** Texto que o usuario ve na linha: a revisao quando existe, senao o original. */
export function segmentText(segment: TranscriptSegment): string {
  return (segment.revised ?? segment.text).replace(/\s+/g, ' ').trim();
}

/** Titulo curto da nota: o proprio trecho, cortado em palavra inteira. */
export function captureTitle(text: string, limit = 72): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit * 0.5 ? cut.slice(0, space) : cut).trimEnd()}...`;
}

export interface CaptureSource {
  /** Titulo da nota de onde o trecho saiu. */
  noteTitle: string;
  /** Minutagem ja formatada (ex.: 01:23). */
  stamp: string;
}

export interface CaptureDraft {
  title: string;
  text: string;
  tag: string;
  label: string;
}

/**
 * Monta a nota: o trecho entre aspas, com a origem embaixo. A tag identifica o
 * tipo sem precisar abrir a nota.
 */
export function buildCapture(kind: CaptureKind, segment: TranscriptSegment, source: CaptureSource): CaptureDraft {
  const option = CAPTURE_OPTIONS.find((item) => item.kind === kind) ?? CAPTURE_OPTIONS[0];
  const text = segmentText(segment);
  const title = captureTitle(text) || option.label;
  const quote = `\u201c${text}\u201d`;
  const origin = source.noteTitle.trim()
    ? `${source.noteTitle.trim()}, ${source.stamp}`
    : source.stamp;
  return {
    title,
    text: `${quote}\n\n— ${origin}`,
    tag: option.tag,
    label: option.label,
  };
}
