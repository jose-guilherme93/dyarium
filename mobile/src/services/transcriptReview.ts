/**
 * Revisao da transcricao com o modelo local (llama.rn).
 *
 * O texto cru do whisper fica intacto em cada trecho; a revisao entra em
 * `revised` e e o que o leitor e a analise usam. Uma janela recusada (contagem
 * diferente, guardrail, erro do modelo) conta como "sem revisao" e o trecho
 * continua cru — mas o numero aparece, em vez de sumir em silencio.
 *
 * A passada e publicada janela a janela: cada janela ja e gravada, mostrada e
 * sincronizada sem esperar o fim, e um app que morre no meio continua da
 * primeira janela que faltou.
 */

import type { AnalysisModelInfo } from '@/core/analysisModels';
import {
  REVIEW_PROMPT_VERSION,
  REVIEW_SCHEMA,
  buildReviewMessages,
  changedSegments,
  parseReviewJson,
  reviewChunks,
  reviewHash,
  reviewResumeFrom,
  reviewWindow,
  visibleTranscript,
  withRevisedTexts,
} from '@/core/transcriptReview';
import type { Recording, TranscriptReview, TranscriptSegment } from '@/core/types';
import { cancelActivity, failActivity, finishActivity, startActivity, updateActivity } from './activity';
import { upsertRecording } from './db';
import { startForegroundTask, stopForegroundTask, updateForegroundTask } from '../../modules/foreground-task';
import { acquireHeavyWork } from './heavyWork';
import { runAnalysis, stopAnalysis } from './localAnalysis';
import { notifyActivity } from './notifications';
import { pushTranscript } from './transcriptSync';
import { emitRecording } from './uploaderLoop';

/** Passadas que o usuario pediu para parar (por id de atividade). */
const cancelledReviews = new Set<string>();

/**
 * Para a revisao no fim da janela atual. O texto ja aplicado fica salvo como
 * passada interrompida, e o centro de atividade mostra "Revisao interrompida".
 */
export async function stopReview(activityId: string): Promise<void> {
  cancelledReviews.add(activityId);
  await stopAnalysis();
}

/** Uma janela revisada, pronta para gravar e publicar. */
export interface ReviewWindow {
  segments: TranscriptSegment[];
  /** Indice do primeiro trecho ainda nao alcancado. */
  reviewedThrough: number;
  /** Trechos sem revisao somados ate aqui. */
  rejected: number;
  /** Quais trechos ficaram sem revisao, para retomar so eles. */
  rejectedIdx: number[];
  /** Media ponderada da compreensao ate aqui; -1 quando ainda nao ha medida. */
  comprehension: number;
  /** Trechos alcancados, para a barra de progresso. */
  done: number;
  total: number;
}

export interface ReviewOutcome {
  segments: TranscriptSegment[];
  review: TranscriptReview;
  /** Trechos alcancados pela passada (pode ser menos que o total). */
  reviewed: number;
  /** Trechos que voltaram sem revisao utilizavel. */
  rejected: number;
  /** Quais trechos ficaram sem revisao, para o "revisar de novo". */
  rejectedIdx: number[];
  /** Trechos com texto diferente do original. */
  changed: number;
  /** Janelas que o modelo respondeu em formato inaceitavel. */
  failedWindows: number;
}

export interface ReviewOptions {
  literal: boolean;
  lowPower?: boolean;
  title?: string;
  /** Retoma daqui: trechos antes deste indice ja foram revisados. */
  from?: number;
  /** Recusados ja acumulados por uma passada anterior interrompida. */
  rejected?: number;
  rejectedIdx?: number[];
  /** Revisa so estes indices (as janelas recusadas da passada anterior). */
  only?: number[];
  /** Primeiro trecho ainda nao alcancado, quando a passada ja andou. */
  through?: number;
  /** Id da atividade em andamento, por gravacao (o chip sabe se ela roda). */
  activityId?: string;
  /** Compreensao media da parte ja revisada, para a retomada nao perder a nota. */
  priorComprehension?: number;
  onProgress?(done: number, total: number): void;
  /** Cada janela pronta: grave e publique sem esperar o fim. */
  onWindow?(window: ReviewWindow): Promise<void> | void;
}

/**
 * Revisa os trechos da transcricao. Puro de banco e de rede: quem chama decide
 * salvar e sincronizar, inclusive no meio da passada.
 */
export async function reviewTranscript(
  segments: TranscriptSegment[],
  model: AnalysisModelInfo,
  options: ReviewOptions,
): Promise<ReviewOutcome> {
  const from = Math.max(0, options.from ?? 0);
  const chunks = reviewChunks(
    segments,
    reviewWindow(model.rank),
    from,
    options.only,
  );
  const activity = options.activityId ?? 'review:transcript';
  cancelledReviews.delete(activity);
  let current = segments;
  let rejected = Math.max(0, options.rejected ?? 0);
  const rejectedIdx = new Set<number>(options.rejectedIdx ?? []);
  if (options.only) {
    // A passada mirada nos recusados reconcilia a lista: o que agora passar
    // deixa de ser recusado.
    for (const index of options.only) rejectedIdx.delete(index);
  }
  let reviewedThrough = Math.max(from, options.through ?? 0);
  let failedWindows = 0;
  let comprehensionSum = 0;
  let comprehensionWeight = 0;
  // Uma passada interrompida guarda a media ja calculada. Retomar do zero faria
  // a nota final refletir so as ultimas janelas, nao a transcricao inteira.
  if (from > 0 && (options.priorComprehension ?? -1) >= 0) {
    const priorWeight = segments
      .slice(0, from)
      .reduce((total, segment) => total + Math.max(segment.text.length, 1), 0);
    if (priorWeight > 0) {
      comprehensionSum = (options.priorComprehension as number) * priorWeight;
      comprehensionWeight = priorWeight;
    }
  }

  if (chunks.length > 0) {
    startActivity({
      id: activity,
      kind: 'analysis',
      title: options.title?.trim() || 'Revisando transcrição',
      detail: 'Preparando modelo',
      stop: { label: 'Parar', run: () => stopReview(activity) },
    });
  }

  let stopped = false;
  try {
    for (let index = 0; index < chunks.length; index += 1) {
      if (cancelledReviews.has(activity)) {
        stopped = true;
        break;
      }
      const chunk = chunks[index];
      updateActivity(activity, { detail: `${reviewedThrough} de ${segments.length}` });
      options.onProgress?.(reviewedThrough, segments.length);

      let parsed: ReturnType<typeof parseReviewJson> = null;
      try {
        const run = await runAnalysis(
          model,
          buildReviewMessages({
            literal: options.literal,
            title: options.title,
            context: chunk.context,
            texts: chunk.indices.map((position) => segments[position].text),
          }),
          {
            lowPower: options.lowPower,
            maxTokens: 500 + 220 * chunk.indices.length,
            schema: REVIEW_SCHEMA,
          },
        );
        parsed = parseReviewJson(run.text, chunk.indices.length);
      } catch {
        // Uma janela que falha nao invalida as outras: os trechos ficam crus e
        // contam como sem revisao.
        parsed = null;
      }
      // Parar aborta a geracao: a janela em curso nao vira recusa nem avanca o
      // ponto de retomada.
      if (cancelledReviews.has(activity)) {
        stopped = true;
        break;
      }

      if (!parsed) {
        failedWindows += 1;
        rejected += chunk.indices.length;
        for (const index of chunk.indices) rejectedIdx.add(index);
      } else {
        const applied = withRevisedTexts(current, chunk.indices, parsed.texts);
        current = applied.segments;
        rejected += applied.refused;
        for (const index of applied.refusedIdx) rejectedIdx.add(index);
        if (parsed.comprehension >= 0) {
          const weight = chunk.indices.reduce(
            (total, position) => total + segments[position].text.length,
            0,
          );
          comprehensionSum += parsed.comprehension * Math.max(weight, 1);
          comprehensionWeight += Math.max(weight, 1);
        }
      }

      reviewedThrough = Math.max(
        reviewedThrough,
        Math.max(...chunk.indices) + 1,
      );
      await options.onWindow?.({
        segments: current,
        reviewedThrough,
        rejected,
        rejectedIdx: [...rejectedIdx].sort((a, b) => a - b),
        comprehension:
          comprehensionWeight > 0
            ? Math.round(comprehensionSum / comprehensionWeight)
            : -1,
        done: reviewedThrough,
        total: segments.length,
      });
    }

    const changed = changedSegments(current);
    const review: TranscriptReview = {
      model: model.id,
      promptVersion: REVIEW_PROMPT_VERSION,
      literal: options.literal,
      comprehension:
        comprehensionWeight > 0 ? Math.round(comprehensionSum / comprehensionWeight) : -1,
      hash: reviewHash(segments),
      rejected,
      rejectedIdx: [...rejectedIdx].sort((a, b) => a - b),
      reviewedThrough,
      // Interrompida nao tem fim: o chip mostra a pausa e retoma daqui.
      finishedAt: stopped ? undefined : new Date().toISOString(),
    };

    // Uma passada que nao aceitou nenhuma janela nao terminou bem, e a atividade
    // nao pode dizer "revisada" para o usuario.
    if (stopped) {
      cancelActivity(activity, 'Revisão interrompida');
    } else if (chunks.length === 0) {
      finishActivity(activity, 'Nada a revisar');
    } else if (reviewedThrough === from && rejected > 0) {
      failActivity(activity, 'Revisão recusada pelo modelo');
    } else if (changed > 0) {
      finishActivity(activity, `${changed} trecho(s) revisado(s)`);
    } else {
      finishActivity(activity, rejected > 0 ? `${rejected} sem revisão` : 'Nada a mudar');
    }

    return {
      segments: current,
      review,
      reviewed: reviewedThrough,
      rejected,
      rejectedIdx: review.rejectedIdx ?? [],
      changed,
      failedWindows,
    };
  } catch (error) {
    failActivity(activity, 'Não foi possível revisar a transcrição');
    throw error;
  }
}

export interface ReviewRecordingOptions {
  literal: boolean;
  lowPower?: boolean;
  title?: string;
  /** Revisa so estes indices (janelas recusadas). */
  only?: number[];
  /** Chamado a cada janela gravada, para a tela reagir na hora. */
  onWindow?(recording: Recording): void;
}

/**
 * Revisa a transcricao gravada no aparelho, de ponta a ponta: retoma do ponto
 * em que parou, grava cada janela, avisa a tela e sincroniza. E o unico caminho
 * de revisao — a nota e a tela de transcricao chamam o mesmo.
 */
export async function reviewRecording(
  recording: Recording,
  model: AnalysisModelInfo,
  options: ReviewRecordingOptions,
): Promise<Recording> {
  const segments = recording.transcriptSegments ?? [];
  if (segments.length === 0) return recording;

  const hash = reviewHash(segments);
  const stored = recording.transcriptReview;
  const samePass = Boolean(
    stored &&
      stored.hash === hash &&
      stored.promptVersion === REVIEW_PROMPT_VERSION &&
      stored.literal === options.literal,
  );
  const resume = options.only ? null : reviewResumeFrom(stored, options.literal, segments);

  // Uma passada de revisao por vez. Entrar na fila antes de abrir a
  // notificacao evita mostrar "Revisando" enquanto uma transcricao ainda roda;
  // a transcricao e pausada no fim da janela atual.
  const lease = await acquireHeavyWork('review');
  // A revisao segura o processo com a tela apagada; o texto da notificacao e
  // a posicao na passada, nunca o texto da nota.
  startForegroundTask('Revisando', options.title || recording.title || 'Nota', 0);
  try {
    let outcome: ReviewOutcome;
    try {
      outcome = await reviewTranscript(segments, model, {
        literal: options.literal,
        lowPower: options.lowPower,
        title: options.title,
        from: resume?.from,
        rejected: resume?.rejected,
        rejectedIdx: options.only ? undefined : samePass ? stored?.rejectedIdx : undefined,
        only: options.only,
        through: samePass ? stored?.reviewedThrough : undefined,
        priorComprehension: samePass ? stored?.comprehension : undefined,
        activityId: `review:${recording.id}`,
        onWindow: async (window) => {
          const partial: Recording = {
            ...recording,
            transcriptSegments: window.segments,
            transcriptReview: {
              model: model.id,
              promptVersion: REVIEW_PROMPT_VERSION,
              literal: options.literal,
              comprehension: window.comprehension,
              hash,
              rejected: window.rejected,
              rejectedIdx: window.rejectedIdx,
              reviewedThrough: window.reviewedThrough,
            },
            transcript: visibleTranscript(window.segments) || recording.transcript,
            updatedAt: new Date().toISOString(),
          };
          await upsertRecording(partial);
          emitRecording(partial);
          options.onWindow?.(partial);
          void notifyActivity({
            stage: 'reviewing',
            noteTitle: options.title || recording.title,
            index: window.reviewedThrough,
            total: window.total,
          });
          updateForegroundTask(
            'Revisando',
            `${window.reviewedThrough} de ${window.total}`,
            Math.round((window.reviewedThrough / Math.max(1, window.total)) * 100),
          );
          // O dashboard le o mesmo texto revisado; a falha de rede nao desfaz nada.
          void pushTranscript(recording.id).catch(() => undefined);
        },
      });
    } finally {
      stopForegroundTask();
    }

    // Revisar so os recusados nao pode substituir a nota de compreensao da
    // transcricao inteira por uma media calculada apenas nesses trechos.
    const review =
      options.only && stored && stored.comprehension >= 0
        ? { ...outcome.review, comprehension: stored.comprehension }
        : outcome.review;
    const next: Recording = {
      ...recording,
      transcriptSegments: outcome.segments,
      transcriptReview: review,
      transcript: visibleTranscript(outcome.segments) || recording.transcript,
      updatedAt: new Date().toISOString(),
    };
    await upsertRecording(next);
    emitRecording(next);
    options.onWindow?.(next);
    void pushTranscript(recording.id).catch(() => undefined);
    return next;
  } finally {
    lease.release();
  }
}
