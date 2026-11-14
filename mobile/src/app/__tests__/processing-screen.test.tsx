import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ProcessingScreen from '@/app/processing';

const mockSetTranscriptionPlace = jest.fn(async () => undefined);
const mockSetAnalysisPlace = jest.fn(async () => undefined);
const mockSetTranscriptionOnlineModel = jest.fn(async () => undefined);
const mockSetAnalysisProvider = jest.fn(async () => undefined);
const mockSetAnalysisBaseUrl = jest.fn(async () => undefined);
const mockSetAnalysisOnlineModel = jest.fn(async () => undefined);
const mockSetTranscriptionLanguage = jest.fn(async () => undefined);
const mockSetReviewTranscript = jest.fn(async () => undefined);
const mockSetLiteralTranscript = jest.fn(async () => undefined);
const mockImport = jest.fn();
const mockPushProviders = jest.fn(async () => true);
const mockReadServerSettings = jest.fn();
const mockLoadProviderKey = jest.fn(async () => null);

jest.mock('@/services/appNavigation', () => ({
  back: jest.fn(),
  push: jest.fn(),
}));

jest.mock('expo-router', () => {
  const React = require('react');
  return {
    useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]),
  };
});

jest.mock('@/services/serverProviders', () => ({
  importProvidersFromServer: () => mockImport(),
  pushProvidersToServer: () => mockPushProviders(),
  readServerSettings: () => mockReadServerSettings(),
  updateServerSettings: jest.fn(async () => true),
}));

jest.mock('@/services/secure', () => ({
  loadProviderKey: () => mockLoadProviderKey(),
  saveProviderKey: jest.fn(async () => undefined),
  clearProviderKey: jest.fn(async () => undefined),
}));

jest.mock('@/services/transcriptionModels', () => ({
  installedModels: () => [],
}));

jest.mock('@/services/analysisModels', () => ({
  installedAnalysisModels: () => [],
}));

jest.mock('@/services/transcripts', () => ({
  sendPendingTranscriptsToServer: jest.fn(async () => ({ sent: 0, failed: 0 })),
}));

jest.mock('@/services/localTranscription', () => ({
  transcribePendingLocally: jest.fn(async () => undefined),
}));

let mockSettings: Record<string, unknown>;
let mockRunning: unknown[] = [];

jest.mock('@/state/SettingsContext', () => ({
  useSettings: () => mockSettings,
}));

jest.mock('@/state/LibraryContext', () => ({
  useLibrary: () => ({ recordings: [], refresh: jest.fn(async () => undefined) }),
}));

jest.mock('@/state/useActivities', () => ({
  useActivities: () => mockRunning,
}));

function settings(overrides: Record<string, unknown> = {}) {
  return {
    config: { baseUrl: 'http://s', token: 't' },
    transcriptionPlace: 'server',
    setTranscriptionPlace: mockSetTranscriptionPlace,
    analysisPlace: 'server',
    setAnalysisPlace: mockSetAnalysisPlace,
    transcriptionOnlineModel: 'nova-3',
    setTranscriptionOnlineModel: mockSetTranscriptionOnlineModel,
    analysisProvider: 'groq',
    setAnalysisProvider: mockSetAnalysisProvider,
    analysisBaseUrl: '',
    setAnalysisBaseUrl: mockSetAnalysisBaseUrl,
    analysisOnlineModel: 'llama-3.3-70b-versatile',
    setAnalysisOnlineModel: mockSetAnalysisOnlineModel,
    transcriptionLanguage: 'pt',
    setTranscriptionLanguage: mockSetTranscriptionLanguage,
    reviewTranscript: false,
    setReviewTranscript: mockSetReviewTranscript,
    setLiteralTranscript: mockSetLiteralTranscript,
    transcriptionModel: 'base',
    analysisModel: 'modelo',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSettings = settings();
  mockRunning = [];
  mockReadServerSettings.mockResolvedValue({
    owner_name: '',
    all_notes_mine: true,
    trim_silence: false,
    whisper_model: 'small',
    whisper_language: 'pt',
    transcribe_provider: 'deepgram',
    deepgram_model: 'nova-2',
    deepgram_api_key_set: true,
    analyze_enabled: true,
    analyze_provider: 'openai',
    analyze_local_runtime: '',
    analyze_base_url: 'https://api.groq.com/openai/v1',
    analyze_model: 'llama-3.3-70b-versatile',
    analyze_api_key_set: true,
    analysis_themes: '',
    review_enabled: false,
    literal_transcript: false,
  });
});

describe('tela de processamento', () => {
  it('mostra o lugar de cada etapa e o que o servidor tem', async () => {
    render(<ProcessingScreen />);

    expect(screen.getByText('Transcrição')).toBeTruthy();
    expect(screen.getByText('Análise')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Deepgram')).toBeTruthy());
    expect(screen.getAllByText('no servidor').length).toBeGreaterThan(0);
  });

  it('trocar o lugar grava a escolha, sem mexer na outra etapa', async () => {
    render(<ProcessingScreen />);
    await waitFor(() => expect(mockReadServerSettings).toHaveBeenCalled());

    fireEvent.press(screen.getByLabelText('Onde roda a transcrição: Online'));

    expect(mockSetTranscriptionPlace).toHaveBeenCalledWith('online');
    expect(mockSetAnalysisPlace).not.toHaveBeenCalled();
  });

  it('importar do servidor aplica provedor e modelo, sem pedir chave', async () => {
    mockImport.mockResolvedValue({
      transcriptionOnlineModel: 'nova-2',
      analysisProvider: 'groq',
      analysisBaseUrl: 'https://api.groq.com/openai/v1',
      analysisOnlineModel: 'llama-3.3-70b-versatile',
      transcriptionLanguage: 'pt',
      reviewTranscript: true,
      literalTranscript: false,
    });
    render(<ProcessingScreen />);
    await waitFor(() => expect(mockReadServerSettings).toHaveBeenCalled());

    fireEvent.press(screen.getByLabelText('Importar do servidor'));

    await waitFor(() => expect(mockSetTranscriptionOnlineModel).toHaveBeenCalledWith('nova-2'));
    expect(mockSetAnalysisProvider).toHaveBeenCalledWith('groq');
    expect(mockSetAnalysisOnlineModel).toHaveBeenCalledWith('llama-3.3-70b-versatile');
    expect(mockLoadProviderKey).not.toHaveBeenCalledWith('analysis');
  });

  it('mostra o andamento real de quem esta transcrevendo', async () => {
    mockRunning = [
      {
        id: 'transcription:r1',
        kind: 'transcription',
        title: 'Nota longa',
        detail: 'Transcrevendo trecho 2 de 5',
        status: 'running',
        progress: 41,
        startedAt: 0,
        seen: true,
      },
    ];
    render(<ProcessingScreen />);

    expect(screen.getByText('Nota longa')).toBeTruthy();
    expect(screen.getByText('Transcrevendo trecho 2 de 5')).toBeTruthy();
    expect(screen.getByText('41%')).toBeTruthy();
  });

  it('mostra a espera do servidor sem inventar porcentagem', async () => {
    mockRunning = [
      {
        id: 'transcription:r2',
        kind: 'transcription',
        title: 'Nota remota',
        detail: 'No servidor',
        status: 'running',
        startedAt: 0,
        seen: true,
      },
    ];
    render(<ProcessingScreen />);

    expect(screen.getByText('Nota remota')).toBeTruthy();
    expect(screen.getAllByText('No servidor').length).toBeGreaterThan(0);
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('sem servidor, importar e enviar nao chamam a rede', async () => {
    mockSettings = settings({ config: null, transcriptionPlace: 'off', analysisPlace: 'off' });
    render(<ProcessingScreen />);

    fireEvent.press(screen.getByLabelText('Importar do servidor'));
    fireEvent.press(screen.getByLabelText('Enviar para o servidor'));

    expect(mockImport).not.toHaveBeenCalled();
    expect(mockPushProviders).not.toHaveBeenCalled();
  });
});
