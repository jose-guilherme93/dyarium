import { fireEvent, render, screen } from '@testing-library/react-native';

import { ProcessingSheet } from '@/components/ProcessingSheet';
import { FLAG_PROCESSING_HINT } from '@/core/flags';
import { setAppFlag } from '@/services/db';

jest.mock('@/services/db', () => ({
  setAppFlag: jest.fn(async () => undefined),
}));

jest.mock('@/services/appNavigation', () => ({
  push: jest.fn(),
}));

jest.mock('@/services/processing', () => ({
  localAnalysisCapable: () => false,
}));

jest.mock('@/services/whisper', () => ({
  localTranscriptionAvailable: () => false,
}));

jest.mock('@/services/transcriptionModels', () => ({
  installedModels: () => [],
}));

jest.mock('@/services/analysisModels', () => ({
  installedAnalysisModels: () => [],
}));

let mockSettings = {
  config: null,
  transcriptionEnabled: false,
  setTranscriptionEnabled: jest.fn(async () => undefined),
  analysisEnabled: false,
  setAnalysisEnabled: jest.fn(async () => undefined),
  serverProcessing: false,
  setServerProcessing: jest.fn(async () => undefined),
  transcriptionModel: 'base',
  analysisModel: 'modelo',
};

jest.mock('@/state/SettingsContext', () => ({
  useSettings: () => mockSettings,
}));

beforeEach(() => {
  mockSettings = {
    config: null,
    transcriptionEnabled: false,
    setTranscriptionEnabled: jest.fn(async () => undefined),
    analysisEnabled: false,
    setAnalysisEnabled: jest.fn(async () => undefined),
    serverProcessing: false,
    setServerProcessing: jest.fn(async () => undefined),
    transcriptionModel: 'base',
    analysisModel: 'modelo',
  };
});

describe('folha de processamento', () => {
  it('ocultar grava a escolha no banco e fecha', async () => {
    const onClose = jest.fn();
    render(<ProcessingSheet visible onClose={onClose} />);

    fireEvent.press(screen.getByText('Ocultar esta mensagem'));

    expect(setAppFlag).toHaveBeenCalledWith(FLAG_PROCESSING_HINT, '1');
    expect(onClose).toHaveBeenCalled();
  });

  it('mostra as tres etapas e o caminho do servidor quando nao ha um', () => {
    render(<ProcessingSheet visible onClose={jest.fn()} />);

    expect(screen.getByText('Transcrição')).toBeTruthy();
    expect(screen.getByText('Análise')).toBeTruthy();
    expect(screen.getByText('Processar no servidor')).toBeTruthy();
    expect(screen.getByText('Conectar servidor')).toBeTruthy();
  });
});
