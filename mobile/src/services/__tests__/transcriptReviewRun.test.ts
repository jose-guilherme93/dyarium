import type { AnalysisModelInfo } from '@/core/analysisModels';
import { REVIEW_PROMPT_VERSION, reviewHash } from '@/core/transcriptReview';
import type { Recording, TranscriptSegment } from '@/core/types';

import { reviewRecording, reviewTranscript } from '../transcriptReview';

const mockRunAnalysis = jest.fn();

jest.mock('../activity', () => ({
  startActivity: jest.fn(),
  updateActivity: jest.fn(),
  finishActivity: jest.fn(),
  failActivity: jest.fn(),
}));

jest.mock('../db', () => ({ upsertRecording: jest.fn() }));

jest.mock('../../../modules/foreground-task', () => ({
  startForegroundTask: jest.fn(),
  stopForegroundTask: jest.fn(),
  updateForegroundTask: jest.fn(),
}));

jest.mock('../localAnalysis', () => ({
  runAnalysis: (...args: unknown[]) => mockRunAnalysis(...args),
}));

jest.mock('../notifications', () => ({ notifyActivity: jest.fn() }));
jest.mock('../transcriptSync', () => ({ pushTranscript: jest.fn(async () => true) }));
jest.mock('../uploaderLoop', () => ({ emitRecording: jest.fn() }));

const model = {
  id: 'modelo-local',
  rank: 3,
  label: 'Modelo',
} as AnalysisModelInfo;

const segments: TranscriptSegment[] = [0, 1, 2, 3, 4, 5].map((index) => ({
  start_ms: index * 1000,
  end_ms: (index + 1) * 1000,
  text: `seg ${index}`,
}));

describe('reviewTranscript', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('retomar uma passada preserva a compreensao ja medida', async () => {
    mockRunAnalysis.mockResolvedValue({
      text: '{"comprehension":100,"segments":["seg 3","seg 4","seg 5"]}',
      wallMs: 1,
      truncated: false,
      timings: null,
    });

    const windows: { comprehension: number; reviewedThrough: number }[] = [];
    const outcome = await reviewTranscript(segments, model, {
      literal: false,
      from: 3,
      through: 3,
      priorComprehension: 40,
      onWindow: (window) => {
        windows.push({
          comprehension: window.comprehension,
          reviewedThrough: window.reviewedThrough,
        });
      },
    });

    // Metade do texto revisada antes com 40, metade agora com 100.
    expect(outcome.review.comprehension).toBe(70);
    expect(windows).toEqual([{ comprehension: 70, reviewedThrough: 6 }]);
  });

  it('a janela leva os indices recusados para a retomada', async () => {
    mockRunAnalysis.mockResolvedValue({
      text: '{"comprehension":-1,"segments":["seg 3","texto completamente diferente","seg 5"]}',
      wallMs: 1,
      truncated: false,
      timings: null,
    });

    const windows: number[][] = [];
    const outcome = await reviewTranscript(segments, model, {
      literal: false,
      from: 3,
      through: 3,
      onWindow: (window) => {
        windows.push(window.rejectedIdx);
      },
    });

    expect(outcome.rejectedIdx).toEqual([4]);
    expect(windows).toEqual([[4]]);
    expect(outcome.review.comprehension).toBe(-1);
  });
});

describe('reviewRecording', () => {
  it('revisar so os recusados preserva a compreensao da passada inteira', async () => {
    const recording: Recording = {
      id: 'rec_1',
      title: 'nota',
      recordedAt: '2026-10-20T10:00:00.000Z',
      dir: '',
      segmentCount: 0,
      status: 'completed',
      offset: 0,
      attempts: 0,
      entryId: 'e1',
      transcriptSegments: segments,
      transcript: segments.map((segment) => segment.text).join('\n'),
      transcriptReview: {
        model: 'modelo-local',
        promptVersion: REVIEW_PROMPT_VERSION,
        literal: false,
        comprehension: 80,
        hash: reviewHash(segments),
        rejected: 1,
        rejectedIdx: [2],
        reviewedThrough: 4,
        finishedAt: '2026-10-20T10:05:00.000Z',
      },
      createdAt: '2026-10-20T10:00:00.000Z',
      updatedAt: '2026-10-20T10:05:00.000Z',
    };
    mockRunAnalysis.mockResolvedValue({
      text: '{"comprehension":-1,"segments":["seg 2"]}',
      wallMs: 1,
      truncated: false,
      timings: null,
    });

    const next = await reviewRecording(recording, model, {
      literal: false,
      only: [2],
    });

    expect(next.transcriptReview?.comprehension).toBe(80);
    expect(next.transcriptReview?.rejected).toBe(0);
    expect(next.transcriptReview?.finishedAt).toBeTruthy();
  });
});
