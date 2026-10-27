import {
  REVIEW_PROMPT_VERSION,
  acceptRevision,
  changedSegments,
  reviewResumeFrom,
  reviewState,
  parseReviewJson,
  perHundred,
  rawTranscript,
  reviewChunks,
  mergeServerTranscript,
  reviewFromServer,
  reviewHash,
  reviewWindow,
  reviewIsCurrent,
  reviewNeedsResume,
  speechCounts,
  visibleSegmentText,
  visibleTranscript,
  withRevisedTexts,
} from '../transcriptReview';
import type { Recording, TranscriptSegment } from '../types';

const segments: TranscriptSegment[] = [
  { start_ms: 0, end_ms: 1000, text: 'a sede do pt fica em sao paulo' },
  { start_ms: 1000, end_ms: 2000, text: 'foram 3 pessoas' },
  { start_ms: 2000, end_ms: 3000, text: 'eu eu falei isso' },
  { start_ms: 3000, end_ms: 4000, text: 'trecho que eu escrevi', edited: true },
];

describe('reviewChunks', () => {
  it('retomar de um ponto nao passa do fim da transcricao', () => {
    const chunks = reviewChunks(segments, 3, 2);
    expect(chunks.map((chunk) => chunk.indices)).toEqual([[2]]);
    expect(reviewChunks(segments, 3, segments.length)).toEqual([]);
  });

  it('fatia em janelas de tres e pula os trechos escritos a mao', () => {
    const chunks = reviewChunks(segments, 3);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].indices).toEqual([0, 1, 2]);
  });

  it('usa janela menor nos modelos mais leves do catalogo', () => {
    expect(reviewWindow(1)).toBe(2);
    expect(reviewWindow(2)).toBe(2);
    expect(reviewWindow(3)).toBe(3);
  });

  it('quebra em varias janelas e leva o trecho anterior como contexto', () => {
    const many = Array.from({ length: 7 }, (_, index) => ({
      start_ms: index * 1000,
      end_ms: (index + 1) * 1000,
      text: `linha ${index}`,
    }));
    const chunks = reviewChunks(many, 3);
    expect(chunks.map((chunk) => chunk.indices)).toEqual([
      [0, 1, 2],
      [3, 4, 5],
      [6],
    ]);
    expect(chunks[1].context).toBe('linha 2');
  });
});

describe('acceptRevision', () => {
  it('aceita correcao de gramatica e explicacao de sigla', () => {
    expect(
      acceptRevision('a sede do pt fica em sao paulo', 'A sede do PT (Partido dos Trabalhadores) fica em São Paulo.'),
    ).toBe(true);
  });

  it('recusa numero trocado e numero novo', () => {
    expect(acceptRevision('foram 3 pessoas', 'foram 4 pessoas')).toBe(false);
    expect(acceptRevision('foram 3 pessoas', 'foram 3 pessoas, um casal')).toBe(false);
  });

  it('recusa reescrita que troca quase tudo', () => {
    expect(
      acceptRevision(
        'hoje eu acordei cedo e fui caminhar na praia com o cachorro',
        'o dia comecou bem cedo com uma caminhada diferente',
      ),
    ).toBe(false);
  });

  it('recusa duas explicacoes no mesmo trecho', () => {
    expect(
      acceptRevision(
        'pt e stf decidiram',
        'PT (Partido dos Trabalhadores) e STF (Supremo Tribunal Federal) decidiram',
      ),
    ).toBe(false);
  });
});

describe('speechCounts', () => {
  it('separa gagueira de hesitacao e preserva a fala legitima', () => {
    const counts = speechCounts('eu eu falei, tipo assim, ne? ee entao');
    expect(counts.words).toBe(8);
    expect(counts.stutter).toBe(1);
    expect(counts.hesitation).toBe(1);
  });

  it('nao conta enfase como gagueira', () => {
    expect(speechCounts('nao nao quero').stutter).toBe(0);
  });

  it('converte para taxa por 100 palavras', () => {
    expect(perHundred(2, 100)).toBe(2);
    expect(perHundred(1, 0)).toBe(0);
  });
});

describe('parseReviewJson', () => {
  it('le a resposta com um texto por trecho', () => {
    const parsed = parseReviewJson(
      '```json\n{"comprehension": 78, "segments": ["um", "dois"]}\n```',
      2,
    );
    expect(parsed).toEqual({ comprehension: 78, texts: ['um', 'dois'] });
  });

  it('recusa contagem diferente da enviada', () => {
    expect(parseReviewJson('{"comprehension": 70, "segments": ["um"]}', 2)).toBeNull();
  });

  it('marca compreensao ausente como -1', () => {
    expect(parseReviewJson('{"segments": ["um"]}', 1)?.comprehension).toBe(-1);
  });

  it('preserva -1 explicito em vez de virar zero', () => {
    expect(
      parseReviewJson('{"comprehension": -1, "segments": ["um"]}', 1)?.comprehension,
    ).toBe(-1);
  });
});

describe('withRevisedTexts', () => {
  it('aplica so o trecho aceito e conta o recusado', () => {
    const { segments: next, refused } = withRevisedTexts(segments, [0, 1], [
      'A sede do PT (Partido dos Trabalhadores) fica em São Paulo.',
      'Foram 9 pessoas.',
    ]);
    expect(next[0].revised).toContain('Partido dos Trabalhadores');
    expect(next[0].text).toBe('a sede do pt fica em sao paulo');
    // Numero trocado: recusado, segue sem revisao — e o numero aparece.
    expect(next[1].revised).toBeUndefined();
    expect(refused).toBe(1);
    expect(changedSegments(next)).toBe(1);
  });

  it('nunca toca no trecho escrito a mao', () => {
    const { segments: next, refused } = withRevisedTexts([segments[3]], [0], ['outro texto']);
    expect(next[0].revised).toBeUndefined();
    expect(refused).toBe(1);
  });
});

describe('texto visivel e revisao atual', () => {
  it('mostra o revisado e envia o cru para o servidor', () => {
    const { segments: next } = withRevisedTexts(segments, [0], [
      'A sede do PT (Partido dos Trabalhadores) fica em São Paulo.',
    ]);
    expect(visibleSegmentText(next[0])).toContain('Partido');
    expect(visibleTranscript(next).split('\n')[0]).toContain('Partido');
    expect(rawTranscript(next, '')).toContain('a sede do pt fica em sao paulo');
  });

  it('reaproveita a revisao do servidor quando prompt, modo e texto batem', () => {
    const review = {
      model: 'outro-modelo',
      promptVersion: REVIEW_PROMPT_VERSION,
      literal: false,
      comprehension: 80,
      hash: reviewHash(segments),
      finishedAt: '2026-10-27T12:00:00.000Z',
    };
    // O modelo nao entra na comparacao: a revisao boa do servidor poupa a bateria.
    expect(reviewIsCurrent(review, false, segments)).toBe(true);
    expect(reviewIsCurrent(review, true, segments)).toBe(false);
    expect(reviewIsCurrent({ ...review, hash: 'outro' }, false, segments)).toBe(false);
  });

  // Uma passada interrompida nao vale como revisao pronta: os trechos que
  // faltaram continuam com o texto do whisper, e a tela precisa dizer isso.
  it('nao trata passada interrompida como revisao atual', () => {
    const review = {
      model: 'modelo',
      promptVersion: REVIEW_PROMPT_VERSION,
      literal: false,
      comprehension: 80,
      hash: reviewHash(segments),
      reviewedThrough: 1,
      rejected: 0,
    };
    expect(reviewIsCurrent(review, false, segments)).toBe(false);
    expect(reviewResumeFrom(review, false, segments)).toEqual({ from: 1, rejected: 0, rejectedIdx: [] });
    expect(reviewResumeFrom({ ...review, literal: true }, false, segments)).toBeNull();
    expect(reviewResumeFrom({ ...review, finishedAt: '2026-10-27T12:00:00.000Z' }, false, segments)).toBeNull();
  });
});

describe('estado da revisao na tela', () => {
  const reviewed = {
    model: 'modelo',
    promptVersion: REVIEW_PROMPT_VERSION,
    literal: false,
    comprehension: 78,
    hash: reviewHash(segments),
    finishedAt: '2026-10-27T12:00:00.000Z',
  };

  it('sem revisao nao e o mesmo que revisao sem mudanca', () => {
    expect(reviewState(undefined, segments)).toEqual({ kind: 'none' });
    expect(reviewState(reviewed, segments)).toEqual({ kind: 'empty', comprehension: 78 });
  });

  it('conta os trechos alterados', () => {
    const { segments: next } = withRevisedTexts(segments, [0], [
      'A sede do PT fica em São Paulo.',
    ]);
    expect(reviewState(reviewed, next)).toEqual({
      kind: 'changed',
      changed: 1,
      comprehension: 78,
    });
  });

  it('recusa nao some no meio dos alterados', () => {
    const { segments: next } = withRevisedTexts(segments, [0], [
      'A sede do PT fica em São Paulo.',
    ]);
    expect(reviewState({ ...reviewed, rejected: 2 }, next)).toEqual({
      kind: 'partial',
      changed: 1,
      rejected: 2,
      comprehension: 78,
    });
  });

  it('passada rodando aparece em andamento', () => {
    const running = { ...reviewed, finishedAt: undefined, reviewedThrough: 2 };
    expect(reviewState(running, segments, true)).toEqual({
      kind: 'running',
      done: 2,
      total: 4,
    });
  });

  it('passada sem fim e sem trabalho agora aparece interrompida', () => {
    // App morto no meio, ou passada cancelada no servidor: ninguem esta
    // revisando, e o chip nao pode girar para sempre.
    const paused = { ...reviewed, finishedAt: undefined, reviewedThrough: 2 };
    expect(reviewState(paused, segments)).toEqual({ kind: 'paused', done: 2, total: 4 });
  });
});

describe('reviewFromServer', () => {
  const serverSegments: TranscriptSegment[] = [
    { start_ms: 0, end_ms: 1000, text: 'a sede do pt', reviewed: true, revised: 'A sede do PT.' },
    { start_ms: 1000, end_ms: 2000, text: 'foram 3 pessoas', reviewed: true },
    { start_ms: 2000, end_ms: 3000, text: 'trecho recusado', reviewed: false },
    { start_ms: 3000, end_ms: 4000, text: 'trecho escrito', edited: true, reviewed: false },
  ];

  const server = {
    revised: true,
    revised_model: 'glm-5.3-flash',
    revised_prompt_version: REVIEW_PROMPT_VERSION,
    revised_literal: false,
    revised_comprehension: 76,
    revised_rejected: 1,
    revised_through: 3,
    revised_finished: true,
    revised_pending: 1,
  };

  it('reconstroi o estado terminado, com os recusados e sem os pendentes', () => {
    const review = reviewFromServer(server, serverSegments);
    expect(review?.finishedAt).toBeTruthy();
    expect(review?.reviewedThrough).toBe(3);
    expect(review?.comprehension).toBe(76);
    expect(review?.rejected).toBe(1);
    // O trecho escrito a mao e o pendente nao entram nos recusados.
    expect(review?.rejectedIdx).toEqual([2]);
    expect(review?.hash).toBe(reviewHash(serverSegments));
  });

  it('passada parcial fica sem fim e retoma do ponto salvo', () => {
    const review = reviewFromServer(
      { ...server, revised_finished: false, revised_through: 2, revised_pending: 2 },
      serverSegments,
    );
    expect(review?.finishedAt).toBeUndefined();
    expect(review?.reviewedThrough).toBe(2);
    expect(review?.rejectedIdx).toEqual([]);
    expect(reviewIsCurrent(review, false, serverSegments)).toBe(false);
    expect(reviewResumeFrom(review, false, serverSegments)).toEqual({
      from: 2,
      rejected: 1,
      rejectedIdx: [],
    });
  });

  it('nao inventa revisao quando o servidor nao marcou', () => {
    expect(reviewFromServer({}, serverSegments)).toBeUndefined();
    expect(reviewFromServer({ revised_prompt_version: 0 }, serverSegments)).toBeUndefined();
  });

  it('revisao importada por versao antiga conta como terminada', () => {
    // Sem finishedAt e sem reviewedThrough: veio de um pull antigo, nao de uma
    // passada local interrompida.
    const legacy = {
      model: 'glm',
      promptVersion: REVIEW_PROMPT_VERSION,
      literal: false,
      comprehension: 70,
      hash: reviewHash(serverSegments),
    };
    expect(reviewState(legacy, serverSegments)).toEqual({
      kind: 'changed',
      changed: 1,
      comprehension: 70,
    });
    expect(reviewIsCurrent(legacy, false, serverSegments)).toBe(true);
  });
});

describe('reviewNeedsResume', () => {
  const partial = {
    model: 'modelo-local',
    promptVersion: REVIEW_PROMPT_VERSION,
    literal: false,
    comprehension: -1,
    hash: 'x',
    reviewedThrough: 4,
  };

  it('retoma uma passada local interrompida com ponto salvo', () => {
    expect(reviewNeedsResume(partial, 'local')).toBe(true);
    expect(reviewNeedsResume(partial, undefined)).toBe(true);
  });

  it('nao retoma revisao do servidor nem passada terminada', () => {
    expect(reviewNeedsResume(partial, 'server')).toBe(false);
    expect(reviewNeedsResume({ ...partial, finishedAt: '2026-10-20T10:00:00Z' }, 'local')).toBe(
      false,
    );
    expect(reviewNeedsResume(undefined, 'local')).toBe(false);
  });

  it('nao confunde revisao importada por versao antiga com interrompida', () => {
    expect(
      reviewNeedsResume(
        { model: 'glm', promptVersion: REVIEW_PROMPT_VERSION, literal: false, comprehension: 70 },
        'server',
      ),
    ).toBe(false);
  });
});

describe('mergeServerTranscript', () => {
  const localBase: Recording = {
    id: 'rec_server',
    title: 'do servidor',
    recordedAt: '2026-10-20T10:00:00.000Z',
    dir: '',
    segmentCount: 0,
    status: 'completed',
    offset: 0,
    attempts: 0,
    entryId: 'e1',
    transcriptOrigin: 'server',
    transcriptStatus: 'ready',
    transcript: 'a sede do pt',
    transcriptSegments: [{ start_ms: 0, end_ms: 1000, text: 'a sede do pt' }],
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
  };

  const payload = {
    text: 'A sede do PT.',
    language: 'pt',
    segments: [
      {
        start_ms: 0,
        end_ms: 1000,
        text: 'a sede do pt',
        reviewed: true,
        revised: 'A sede do PT.',
      },
      { start_ms: 1000, end_ms: 2000, text: 'foram 3 pessoas', reviewed: true },
    ],
    revised: true,
    revised_model: 'glm-5.3-flash',
    revised_prompt_version: REVIEW_PROMPT_VERSION,
    revised_comprehension: 82,
    revised_rejected: 0,
    revised_through: 2,
    revised_finished: true,
    revised_pending: 0,
  };

  it('aplica revisao feita no servidor depois do primeiro pull', () => {
    const merged = mergeServerTranscript(localBase, payload);
    expect(merged?.transcript).toBe('A sede do PT.');
    expect(merged?.transcriptOrigin).toBe('server');
    expect(merged?.transcriptSegments).toHaveLength(2);
    expect(merged?.transcriptReview).toMatchObject({
      model: 'glm-5.3-flash',
      comprehension: 82,
      reviewedThrough: 2,
      rejected: 0,
    });
    expect(merged?.transcriptReview?.finishedAt).toBeTruthy();
  });

  it('nao desfaz edicao manual pendente', () => {
    const edited: Recording = {
      ...localBase,
      transcriptSegments: [{ ...localBase.transcriptSegments![0], edited: true }],
    };
    expect(mergeServerTranscript(edited, payload)).toBeNull();
  });

  it('nao reescreve a nota quando a passada e a mesma', () => {
    const first = mergeServerTranscript(localBase, payload);
    expect(first).not.toBeNull();
    expect(mergeServerTranscript(first!, payload)).toBeNull();
  });

  it('adota a transcricao refeita pelo servidor por cima da copia local', () => {
    const local: Recording = { ...localBase, transcriptOrigin: 'local' };
    const adopted = mergeServerTranscript(
      local,
      {
        model: '/models/ggml-small.bin',
        text: 'texto do servidor',
        language: 'pt',
        segments: [{ start_ms: 0, end_ms: 1000, text: 'texto do servidor' }],
      },
      { adopt: true },
    );
    expect(adopted?.transcript).toBe('texto do servidor');
    expect(adopted?.transcriptOrigin).toBe('server');
    expect(adopted?.hasTranscript).toBe(true);
    expect(adopted?.transcriptReview).toBeUndefined();
  });

  it('nao adota quando o texto do servidor veio do proprio app', () => {
    const local: Recording = {
      ...localBase,
      transcriptOrigin: 'local',
      transcriptSegments: [{ start_ms: 0, end_ms: 1000, text: 'texto local' }],
    };
    expect(
      mergeServerTranscript(
        local,
        {
          model: 'local',
          text: 'texto local',
          segments: [{ start_ms: 0, end_ms: 1000, text: 'texto local' }],
        },
        { adopt: true },
      ),
    ).toBeNull();
  });

  it('aplica retranscricao do servidor e descarta a revisao do texto antigo', () => {
    const withLocalReview: Recording = {
      ...localBase,
      transcriptReview: {
        model: 'modelo-local',
        promptVersion: REVIEW_PROMPT_VERSION,
        literal: false,
        comprehension: 70,
        hash: reviewHash(localBase.transcriptSegments!),
        finishedAt: '2026-10-20T10:05:00.000Z',
      },
    };
    const merged = mergeServerTranscript(withLocalReview, {
      text: 'outro audio inteiro',
      language: 'pt',
      segments: [{ start_ms: 0, end_ms: 1000, text: 'outro audio inteiro' }],
    });
    expect(merged?.transcriptReview).toBeUndefined();
    expect(merged?.transcriptSegments?.[0].text).toBe('outro audio inteiro');
  });

  it('nao rebaixa revisao local quando o servidor nao tem nenhuma', () => {
    const withLocalReview: Recording = {
      ...localBase,
      transcriptReview: {
        model: 'modelo-local',
        promptVersion: REVIEW_PROMPT_VERSION,
        literal: false,
        comprehension: 70,
        hash: reviewHash(localBase.transcriptSegments!),
        finishedAt: '2026-10-20T10:05:00.000Z',
      },
    };
    const raw = {
      text: 'a sede do pt',
      language: 'pt',
      segments: [{ start_ms: 0, end_ms: 1000, text: 'a sede do pt' }],
    };
    expect(mergeServerTranscript(withLocalReview, raw)).toBeNull();
  });
});
