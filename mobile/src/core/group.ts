/**
 * Agrupamento da biblioteca por ano. A linha do tempo mostra os anos do mais
 * novo para o mais antigo e, dentro de cada ano, as notas mais recentes em
 * cima. Usa a data do evento (`recordedAt`, no fuso local), nao a data de
 * criacao, para que notas antigas importadas apareçam no ano a que pertencem.
 *
 * Puro e testavel.
 */

import type { Recording } from './types';

export interface RecordingSection {
  /** Ano do calendario local. */
  year: number;
  /** Rotulo exibido no cabecalho da secao. */
  title: string;
  data: Recording[];
}

function localYear(iso: string): number {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return new Date().getFullYear();
  return date.getFullYear();
}

/** Agrupa as gravacoes por ano, mais novo primeiro, com itens mais recentes no topo. */
export function groupRecordingsByYear(recordings: Recording[]): RecordingSection[] {
  const buckets = new Map<number, Recording[]>();
  for (const recording of recordings) {
    const year = localYear(recording.recordedAt);
    const bucket = buckets.get(year);
    if (bucket) bucket.push(recording);
    else buckets.set(year, [recording]);
  }
  return [...buckets.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, data]) => ({
      year,
      title: String(year),
      data: [...data].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)),
    }));
}
