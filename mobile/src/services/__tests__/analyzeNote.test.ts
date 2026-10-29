import { CHUNK_PROMPT_VERSION, type ChunkExtraction } from '@/core/analysisChunk';
import type { AnalysisModelInfo } from '@/core/analysisModels';
import { planAnalysis } from '@/core/analysisPlan';
import type { Recording } from '@/core/types';

import {
  analyzeNote,
  releaseAnalysisContext,
  type AnalysisPassProgress,
} from '../localAnalysis';
import type { StoredAnalysisChunk } from '../db';

const mockCompletion = jest.fn();
const mockListAnalysisChunks = jest.fn<Promise<StoredAnalysisChunk[]>, [string]>();
const mockSaveAnalysisChunks = jest.fn<Promise<void>, [StoredAnalysisChunk[]]>();
const mockDeleteAnalysisChunks = jest.fn<Promise<void>, [string]>();

jest.mock('expo-device', () => ({ totalMemory: 8 * 1024 ** 3 }));
jest.mock('expo-file-system', () => ({
  File: class {
    uri: string;
    exists = true;
    size = 100;
    constructor(uri: string) {
      this.uri = uri;
    }
  },
}));
jest.mock('llama.rn', () => ({
  initLlama: jest.fn(async () => ({
    completion: (...args: unknown[]) => mockCompletion(...args),
    stopCompletion: jest.fn(async () => undefined),
    clearCache: jest.fn(async () => undefined),
    release: jest.fn(async () => undefined),
  })),
}));
jest.mock('../analysisModels', () => ({
  analysisModelFilePath: () => 'file:///model.gguf',
}));
jest.mock('../authorSettings', () => ({
  loadAuthorSettings: async () => ({ ownerName: '', allNotesMine: true }),
}));
jest.mock('../heavyWork', () => ({
  acquireHeavyWork: async () => ({ release: jest.fn() }),
  registerEngineReleaser: jest.fn(),
  reserveEngine: jest.fn(async () => undefined),
}));
jest.mock('../activity', () => ({
  startActivity: jest.fn(),
  updateActivity: jest.fn(),
  finishActivity: jest.fn(),
  cancelActivity: jest.fn(),
  failActivity: jest.fn(),
}));
jest.mock('../notifications', () => ({
  notifyActivity: jest.fn(),
  notifyIfHidden: jest.fn(),
}));
jest.mock('../../../modules/foreground-task', () => ({
  startForegroundTask: jest.fn(),
  stopForegroundTask: jest.fn(),
}));
jest.mock('../db', () => ({
  listCachedAnalyses: jest.fn(async () => []),
  listAnalysisChunks: (...args: [string]) => mockListAnalysisChunks(...args),
  saveAnalysisChunks: (...args: [StoredAnalysisChunk[]]) => mockSaveAnalysisChunks(...args),
  deleteAnalysisChunks: (...args: [string]) => mockDeleteAnalysisChunks(...args),
}));

const model = {
  id: 'modelo-analise',
  sizeBytes: 100,
  minRamBytes: 0,
  rank: 1,
} as AnalysisModelInfo;

/** Resposta crua do modelo (contrato em portugues). */
const CHUNK = {
  tom: -40,
  pessoas: [{ nome: 'Ana' }],
  lugares: [],
  emocoes: ['luto'],
  temas: ['familia'],
  eventos: ['enterro da Ana'],
  decisoes: ['vou viajar em julho'],
  tarefas: [],
  ideias: [],
  epifanias: ['sem saber o que dizer para as pessoas'],
  momentos: ['Fui ao enterro da Ana'],
};

/** Extração ja normalizada, como fica no cache. */
const EXTRACTION: ChunkExtraction = {
  tone: -40,
  people: ['Ana'],
  places: [],
  emotions: ['luto'],
  themes: ['familia'],
  events: ['enterro da Ana'],
  decisions: ['vou viajar em julho'],
  tasks: [],
  ideas: [],
  epiphanies: ['sem saber o que dizer para as pessoas'],
  moments: ['Fui ao enterro da Ana'],
};

function recording(text: string): Pick<Recording, 'id' | 'text' | 'transcript' | 'transcriptSegments' | 'author'> {
  return { id: 'r1', text, transcript: '', transcriptSegments: [], author: '' };
}

function storedChunk(entryId: string, index: number, hash: string): StoredAnalysisChunk {
  return {
    entryId,
    blockIndex: index,
    blockHash: hash,
    promptVersion: CHUNK_PROMPT_VERSION,
    model: model.id,
    status: 'ok',
    dropped: 0,
    extraction: EXTRACTION,
  };
}

/** Responde o contrato do bloco; a chamada da frase e identificada pelo prompt. */
function completionAnswer(sentence = 'Uma despedida anunciada, sobre Ana.') {
  mockCompletion.mockImplementation(async (params: { messages: { content: string }[] }) => {
    const system = params.messages[0].content;
    if (system.includes('UMA frase')) {
      return {
        content: JSON.stringify({ frase: sentence }),
        timings: { prompt_n: 10, predicted_n: 8, predicted_ms: 100 },
      };
    }
    return {
      content: JSON.stringify(CHUNK),
      timings: { prompt_n: 20, predicted_n: 12, predicted_ms: 200 },
    };
  });
}

const noteText =
  'Fui ao enterro da Ana e fiquei ali um bom tempo, sem saber o que dizer para as pessoas. ' +
  'Foi um dia estranho e silencioso, daqueles que a gente guarda sem entender.\n\n' +
  'Depois voltei para casa e passei a tarde inteira lembrando da conversa que tivemos no carro. ' +
  'Decidi que vou viajar em julho para ver a familia e tentar descansar um pouco.';

describe('analyzeNote', () => {
  afterEach(async () => {
    await releaseAnalysisContext();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockListAnalysisChunks.mockResolvedValue([]);
    mockSaveAnalysisChunks.mockResolvedValue(undefined);
    mockDeleteAnalysisChunks.mockResolvedValue(undefined);
    completionAnswer();
  });

  it('le a nota por blocos, grava cada um e compoe o documento completo', async () => {
    const stages: string[] = [];
    const result = await analyzeNote(recording(noteText), model, {
      entryKey: 'e1',
      title: 'Despedida',
      onStage: (stage) => stages.push(stage),
    });

    // Fila, carga do modelo, leitura e a frase final.
    expect(stages[0]).toBe('queued');
    expect(stages).toContain('loading');
    expect(stages).toContain('reading');
    expect(stages).toContain('sentence');

    expect(result.plan.blocks.length).toBeGreaterThan(1);
    expect(result.doc.blocksRead).toBe(result.doc.blocksTotal);
    expect(result.complete).toBe(true);
    expect(result.readNow).toBe(result.doc.blocksTotal);
    expect(mockSaveAnalysisChunks).toHaveBeenCalledTimes(result.doc.blocksTotal);

    const saved = mockSaveAnalysisChunks.mock.calls[0][0][0];
    expect(saved).toMatchObject({
      entryId: 'e1',
      blockIndex: 0,
      promptVersion: CHUNK_PROMPT_VERSION,
      model: model.id,
      status: 'ok',
    });

    expect(result.doc.people[0]).toMatchObject({ name: 'Ana', mentions: 1 });
    expect(result.doc.events).toEqual([{ name: 'enterro da Ana', blocks: 1, startMs: null }]);
    expect(result.doc.decisions.map((item) => item.text)).toEqual(['vou viajar em julho']);
    expect(result.doc.epiphanies.map((item) => item.text)).toEqual([
      'sem saber o que dizer para as pessoas',
    ]);
    expect(result.doc.moments[0].text).toBe('Fui ao enterro da Ana');
    expect(result.doc.sentence).toBe('Uma despedida anunciada, sobre Ana.');
    expect(result.doc.sentenceSource).toBe('model');
  });

  it('informa o progresso por bloco sem callback de token', async () => {
    const progress: AnalysisPassProgress[] = [];
    const result = await analyzeNote(recording(noteText), model, {
      entryKey: 'e3',
      title: 'Progresso',
      onProgress: (item) => progress.push(item),
    });

    expect(progress.length).toBe(result.doc.blocksTotal);
    expect(progress[progress.length - 1]).toMatchObject({
      read: result.doc.blocksTotal,
      total: result.doc.blocksTotal,
    });
    expect(progress[progress.length - 1].tokens).toBeGreaterThan(0);
    // Sem o segundo argumento: nenhum token atravessa a ponte nativa.
    for (const call of mockCompletion.mock.calls) {
      expect(call).toHaveLength(1);
    }
  });

  it('tenta o prompt curto quando o bloco volta sem nenhum item', async () => {
    let shortCalls = 0;
    mockCompletion.mockImplementation(async (params: { messages: { content: string }[] }) => {
      const system = params.messages[0].content;
      if (system.includes('UMA frase')) {
        return {
          content: JSON.stringify({ frase: 'Uma despedida anunciada, sobre Ana.' }),
          timings: { prompt_n: 10, predicted_n: 8, predicted_ms: 100 },
        };
      }
      // Prompt curto: devolve o contrato preenchido. Prompt longo: vazio.
      if (system.includes('lista vazia quando')) {
        shortCalls += 1;
        return {
          content: JSON.stringify(CHUNK),
          timings: { prompt_n: 20, predicted_n: 12, predicted_ms: 200 },
        };
      }
      return {
        content: JSON.stringify({
          ...CHUNK,
          pessoas: [],
          lugares: [],
          emocoes: [],
          temas: [],
          eventos: [],
          decisoes: [],
          tarefas: [],
          ideias: [],
          epifanias: [],
          momentos: [],
        }),
        timings: { prompt_n: 20, predicted_n: 12, predicted_ms: 200 },
      };
    });

    const result = await analyzeNote(recording(noteText), model, {
      entryKey: 'e5',
      title: 'Retry curto',
    });

    expect(shortCalls).toBeGreaterThan(0);
    expect(result.doc.people.map((person) => person.name)).toContain('Ana');
  });

  it('descarta o nome do exemplo quando ele so aparece dentro de outra palavra', async () => {
    mockCompletion.mockImplementation(async (params: { messages: { content: string }[] }) => {
      const system = params.messages[0].content;
      if (system.includes('UMA frase')) {
        return { content: '{"frase":"Um dia comum, sem nada de especial."}', timings: null };
      }
      return {
        content: JSON.stringify({ ...CHUNK, pessoas: [{ nome: 'Ana' }], momentos: [] }),
        timings: null,
      };
    });

    const result = await analyzeNote(
      recording(
        'Na semana passada eu fiquei em casa o dia inteiro sem fazer nada de especial. ' +
          'Foi um dia comum e silencioso, desses que passam sem deixar marca.',
      ),
      model,
      { entryKey: 'e2', title: 'Semana' },
    );

    expect(result.doc.people).toEqual([]);
    expect(result.doc.sentence).not.toContain('Ana');
  });

  it('bloco sem JSON utilizavel deixa a analise parcial e nao inventa o bloco', async () => {
    let call = 0;
    mockCompletion.mockImplementation(async (params: { messages: { content: string }[] }) => {
      const system = params.messages[0].content;
      if (system.includes('UMA frase')) {
        return { content: '{"frase":"x"}', timings: null };
      }
      call += 1;
      return {
        content: call === 1 ? JSON.stringify(CHUNK) : 'nao sei responder',
        timings: null,
      };
    });

    const result = await analyzeNote(recording(noteText), model, {
      entryKey: 'e1',
      title: 'Despedida',
    });

    expect(result.complete).toBe(false);
    expect(result.doc.blocksRead).toBe(1);
    expect(result.rejected).toBe(result.doc.blocksTotal - 1);
    // O bloco recusado fica gravado para o Continuar tentar de novo.
    const statuses = mockSaveAnalysisChunks.mock.calls.map(([chunks]) => chunks[0].status);
    expect(statuses).toContain('rejected');
    // Sem todos os blocos, a frase e derivada dos campos (nenhuma chamada extra).
    expect(result.doc.sentenceSource).toBe('derived');
  });

  it('retoma do bloco que faltou e nao rele o que ja estava valido', async () => {
    const plan = planAnalysis(recording(noteText));
    mockListAnalysisChunks.mockResolvedValue([
      storedChunk('e1', plan.blocks[0].index, plan.blocks[0].hash),
    ]);

    const result = await analyzeNote(recording(noteText), model, {
      entryKey: 'e1',
      title: 'Despedida',
    });

    expect(result.readNow).toBe(plan.blocks.length - 1);
    expect(result.complete).toBe(true);
    const touched = mockSaveAnalysisChunks.mock.calls.flatMap(([chunks]) =>
      chunks.map((chunk) => chunk.blockIndex),
    );
    expect(touched).not.toContain(plan.blocks[0].index);
  });

  it('recomecar apaga os blocos antes de ler', async () => {
    await analyzeNote(recording(noteText), model, {
      entryKey: 'e1',
      title: 'Despedida',
      restart: true,
    });
    expect(mockDeleteAnalysisChunks).toHaveBeenCalledWith('e1');
    expect(mockListAnalysisChunks).not.toHaveBeenCalled();
  });

  it('nao grava blocos no benchmark', async () => {
    await analyzeNote(recording(noteText), model, {
      entryKey: 'bench:r1',
      title: 'Despedida',
      persist: false,
    });
    expect(mockSaveAnalysisChunks).not.toHaveBeenCalled();
  });
});
