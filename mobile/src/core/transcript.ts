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
/**
 * Combina a leitura mais nova do banco (`latest`) com o que a execucao em voo
 * ainda tem em memoria (`previous`). O resultado e o que vai para o banco: tudo
 * o que o usuario mudou no meio do caminho — apagar a nota, editar titulo, tags
 * ou caderno — vem de `latest` e continua valendo. Da transcricao, o que
 * `latest` nao trouxer e completado com o de `previous`, sem nunca rebaixar um
 * estado ja pronto (era assim que a nota ficava em "Transcrevendo" para sempre).
 */
export function mergeTranscript(previous: Recording, latest: Recording): Recording {
  const transcript = latest.transcript ?? previous.transcript;
  const transcriptSegments = latest.transcriptSegments ?? previous.transcriptSegments;
  const hasText = Boolean(transcript?.trim()) || Boolean(transcriptSegments?.length);
  const transcriptStatus =
    latest.transcriptStatus ?? (hasText || latest.hasTranscript ? 'ready' : 'pending');
  return {
    ...latest,
    transcript,
    transcriptLanguage: latest.transcriptLanguage ?? previous.transcriptLanguage,
    transcriptSegments,
    transcriptOrigin: latest.transcriptOrigin ?? previous.transcriptOrigin,
    hasTranscript: latest.hasTranscript ?? previous.hasTranscript,
    transcriptStatus,
  };
}
