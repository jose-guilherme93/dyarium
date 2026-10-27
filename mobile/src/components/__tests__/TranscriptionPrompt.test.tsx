import { fireEvent, render, screen } from '@testing-library/react-native';

import { TranscriptionPrompt } from '@/components/TranscriptionPrompt';

describe('aviso de transcricao e analise desligadas', () => {
  it('leva para os ajustes com um toque', () => {
    const onOpenSettings = jest.fn();
    render(
      <TranscriptionPrompt
        visible
        onClose={jest.fn()}
        onDismiss={jest.fn()}
        onOpenSettings={onOpenSettings}
      />,
    );

    expect(screen.getByText('Transcrição e análise desligadas')).toBeTruthy();
    expect(screen.getByText(/Opções > Modelos no aparelho/)).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Abrir ajustes de transcrição e análise'));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('o X dispensa o aviso de vez', () => {
    const onDismiss = jest.fn();
    render(
      <TranscriptionPrompt
        visible
        onClose={jest.fn()}
        onDismiss={onDismiss}
        onOpenSettings={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByLabelText('Fechar aviso e não mostrar de novo'));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('fechar pelo fundo nao dispensa', () => {
    const onClose = jest.fn();
    const onDismiss = jest.fn();
    render(
      <TranscriptionPrompt
        visible
        onClose={onClose}
        onDismiss={onDismiss}
        onOpenSettings={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByLabelText('Fechar aviso'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
