import { AppState } from 'react-native';

import type { Recording } from '@/core/types';

import {
  maybeTranscribeLocally,
  releaseTranscriptionContexts,
  transcribeLocally,
  transcribePendingLocally,
} from '../localTranscription';
import { resetHeavyWorkForTests } from '../heavyWork';

const mockListRecordings = jest.fn<Promise<Recording[]>, []>();
const mockGetRecording = jest.fn<Promise<Recording | null>, [string]>();
const mockUpsertRecording = jest.fn<Promise<void>, [Recording]>();
const mockLoadPrefs = jest.fn();
const mockWillTranscribeLocally = jest.fn<Promise<boolean>, []>();
const mockLoadWhisper = jest.fn();
const mockDecode = jest.fn();

jest.mock('expo-file-system', () => ({
  Directory: class {
    exists = true;
    create() {}
  },
  File: class {
    exists = true;
    delete() {
      this.exists = false;
    }
  },
  FileMode: {},
  Paths: {},
}));

jest.mock('../../../modules/audio-decode', () => ({
  audioDecodeAvailable: () => true,
  decodeToWav: (...args: unknown[]) => mockDecode(...args),
}));

jest.mock('../../../modules/foreground-task', () => ({
  startForegroundTask: jest.fn(),
  stopForegroundTask: jest.fn(),
  updateForegroundTask: jest.fn(),
}));

jest.mock('../activity', () => ({
  startActivity: jest.fn(),
  updateActivity: jest.fn(),
  finishActivity: jest.fn(),
  failActivity: jest.fn(),
  cancelActivity: jest.fn(),
}));

jest.mock('../db', () => ({
  listRecordings: () => mockListRecordings(),
  getRecording: (...args: [string]) => mockGetRecording(...args),
  upsertRecording: (...args: [Recording]) => mockUpsertRecording(...args),
}));

jest.mock('../notifications', () => ({
  ensureNotificationPermission: jest.fn(),
  notifyIfHidden: jest.fn(),
  notifyActivity: jest.fn(),
}));

jest.mock('../uploaderLoop', () => ({ emitRecording: jest.fn() }));
jest.mock('../secure', () => ({ loadPrefs: () => mockLoadPrefs() }));
jest.mock('../transcriptionModels', () => ({ modelFilePath: () => '/models/tiny.bin' }));
jest.mock('../transcriptSync', () => ({ pushTranscript: jest.fn(async () => true) }));

// Sem o modulo nativo a transcricao para antes de tocar no audio: o teste
// observa quais notas sequer foram lidas.
jest.mock('../whisper', () => ({
  loadWhisper: () => mockLoadWhisper(),
  localTranscriptionAvailable: () => true,
  willTranscribeLocally: () => mockWillTranscribeLocally(),
}));

function base(overrides: Partial<Recording> = {}): Recording {
  return {
    id: 'r1',
    title: 'nota',
    recordedAt: '2026-10-20T10:00:00.000Z',
    dir: '',
    segmentCount: 1,
    status: 'completed',
    offset: 0,
    attempts: 0,
    filePath: '/audio/r1.aac',
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
    ...overrides,
  };
}

const serverNote = base({
  id: 'srv',
  entryId: 'e1',
  transcript: 'texto do servidor',
  transcriptStatus: 'ready',
  transcriptOrigin: 'server',
});
const readyWithoutFlag = base({ id: 'srv2', entryId: 'e2', transcriptStatus: 'ready' });
const localPending = base({
  id: 'loc',
  entryId: 'e3',
  transcriptStatus: 'pending',
  transcriptOrigin: 'local',
});
const notUploaded = base({ id: 'novo' });

const byId: Record<string, Recording> = {
  srv: serverNote,
  srv2: readyWithoutFlag,
  loc: localPending,
  novo: notUploaded,
};

beforeEach(() => {
  jest.clearAllMocks();
  // A fila so inicia trabalho pesado com o app na frente.
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  resetHeavyWorkForTests();
  mockWillTranscribeLocally.mockResolvedValue(true);
  mockLoadWhisper.mockReturnValue(null);
  mockLoadPrefs.mockResolvedValue({ transcriptionModel: 'tiny' });
  mockGetRecording.mockImplementation(async (id) => byId[id] ?? null);
  mockListRecordings.mockResolvedValue([serverNote, readyWithoutFlag, localPending, notUploaded]);
});

/**
 * O defeito: ligar a transcricao local e baixar o modelo fazia a fila varrer o
 * acervo e refazer tudo o que o servidor tinha transcrito enquanto a opcao
 * estava desligada.
 */
describe('transcribePendingLocally', () => {
  it('nao refaz nota que o servidor transcreveu', async () => {
    await transcribePendingLocally();

    const ids = mockGetRecording.mock.calls.map(([id]) => id);
    expect(ids).not.toContain('srv');
    expect(ids).not.toContain('srv2');
    // O que e nosso continua: a passada local interrompida e a nota nova.
    expect(ids).toContain('loc');
    expect(ids).toContain('novo');
  });

  it('nao reabre o audio de nota pendente que pertence ao servidor', async () => {
    const uploadingAtServer = base({ id: 'srv3', entryId: 'e9', transcriptStatus: 'pending' });
    mockListRecordings.mockResolvedValue([uploadingAtServer]);

    await transcribePendingLocally();

    expect(mockGetRecording).not.toHaveBeenCalledWith('srv3');
  });

  it('nao comeca trabalho pesado com o app em segundo plano', async () => {
    Object.defineProperty(AppState, 'currentState', { value: 'background', configurable: true });

    await transcribePendingLocally();

    expect(mockGetRecording).not.toHaveBeenCalled();
  });

  it('nao faz nada com a transcricao local desligada', async () => {
    mockWillTranscribeLocally.mockResolvedValue(false);

    await transcribePendingLocally();

    expect(mockListRecordings).not.toHaveBeenCalled();
  });
});

describe('transcribeLocally', () => {
  it('retomar a passada nao apaga o texto que ja estava na nota', async () => {
    const withText = { ...localPending, transcript: 'texto antigo' };
    mockGetRecording.mockResolvedValue(withText);
    mockLoadWhisper.mockReturnValue({});
    mockDecode.mockRejectedValueOnce(new Error('sem audio'));

    await transcribeLocally('loc');

    const first = mockUpsertRecording.mock.calls[0]?.[0];
    expect(first?.transcript).toBe('texto antigo');
    // O timer de ociosidade do contexto nao deve segurar a suite aberta.
    await releaseTranscriptionContexts();
  });
});

describe('maybeTranscribeLocally', () => {
  it('nao refaz uma transcricao pronta nem pelo caminho do botao', async () => {
    await maybeTranscribeLocally('srv');

    expect(mockGetRecording).toHaveBeenCalledWith('srv');
    expect(mockLoadPrefs).not.toHaveBeenCalled();
  });

  it('transcreve a nota nova quando o usuario pede', async () => {
    await maybeTranscribeLocally('novo');

    expect(mockLoadPrefs).toHaveBeenCalled();
  });
});
