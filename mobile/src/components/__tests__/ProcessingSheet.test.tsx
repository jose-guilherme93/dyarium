import { fireEvent, render, screen } from '@testing-library/react-native';

import { ProcessingSheet } from '@/components/ProcessingSheet';
import { FLAG_PROCESSING_HINT } from '@/core/flags';
import { setAppFlag } from '@/services/db';
import { push } from '@/services/appNavigation';

jest.mock('@/services/db', () => ({
  setAppFlag: jest.fn(async () => undefined),
}));

jest.mock('@/services/appNavigation', () => ({
  push: jest.fn(),
}));

let mockSettings = {
  transcriptionPlace: 'server',
  analysisPlace: 'device',
};

jest.mock('@/state/SettingsContext', () => ({
  useSettings: () => mockSettings,
}));

beforeEach(() => {
  mockSettings = { transcriptionPlace: 'server', analysisPlace: 'device' };
  jest.clearAllMocks();
});

describe('folha de processamento', () => {
  it('ocultar grava a escolha no banco e fecha', async () => {
    const onClose = jest.fn();
    render(<ProcessingSheet visible onClose={onClose} />);

    fireEvent.press(screen.getByText('Ocultar esta mensagem'));

    expect(setAppFlag).toHaveBeenCalledWith(FLAG_PROCESSING_HINT, '1');
    expect(onClose).toHaveBeenCalled();
  });

  it('mostra o lugar de cada etapa e leva a tela de processamento', () => {
    render(<ProcessingSheet visible onClose={jest.fn()} />);

    expect(screen.getByText('Transcrição')).toBeTruthy();
    expect(screen.getByText('Análise')).toBeTruthy();
    expect(screen.getByText('Servidor')).toBeTruthy();
    expect(screen.getByText('Aparelho')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Transcrição: Servidor. Ajustar processamento'));
    expect(push).toHaveBeenCalledWith('/processing');
  });
});
