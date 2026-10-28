/**
 * Logica pura dos segmentos da transcricao. Separada dos componentes para
 * poder ser testada de verdade (ver AGENTS.md, secao de testes).
 */

import type { Recording, TranscriptSegment } from './types';

/**
 * Indice do ultimo segmento que ja comecou ate `currentMs` (o que esta sendo
 * falado agora). Devolve -1 antes do primeiro segmento.
 */
export function activeSegmentIndex(segments: TranscriptSegment[], currentMs: number): number {
  let index = -1;
  for (let i = 0; i < segments.length; i += 1) {
    if (segments[i].start_ms <= currentMs) index = i;
    else break;
  }
  return index;
}

/**
 * Preserva a transcricao local ao concluir um envio. O upload pode terminar
 * depois de a transcricao no aparelho ficar pronta; sem isto o registro era
 * sobrescrito sem o texto e o status voltava para "pending", deixando a nota
 * presa em "Transcrevendo" para sempre. Nunca rebaixa um estado ja pronto.
 */
export function mergeTranscript(base: Recording, fresh: Recording): Recording {
  const hasText = Boolean(fresh.transcript?.trim()) || Boolean(fresh.transcriptSegments?.length);
  const transcriptStatus =
    fresh.transcriptStatus ?? (hasText || fresh.hasTranscript ? 'ready' : 'pending');
  return {
    ...base,
    transcript: fresh.transcript ?? base.transcript,
    transcriptLanguage: fresh.transcriptLanguage ?? base.transcriptLanguage,
    transcriptSegments: fresh.transcriptSegments ?? base.transcriptSegments,
    transcriptOrigin: fresh.transcriptOrigin ?? base.transcriptOrigin,
    hasTranscript: fresh.hasTranscript ?? base.hasTranscript,
    transcriptStatus,
  };
}
