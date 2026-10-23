import { fireEvent, render, screen } from '@testing-library/react-native';

import { SyncedTranscript } from '@/components/SyncedTranscript';
import type { TranscriptSegment } from '@/core/types';

const segments: TranscriptSegment[] = [
  { start_ms: 0, end_ms: 5_000, text: 'bom dia' },
  { start_ms: 5_000, end_ms: 12_000, text: 'hoje e quinta' },
  { start_ms: 12_000, end_ms: 20_000, text: 'vou falar do projeto' },
];

describe('SyncedTranscript', () => {
  it('toque numa linha leva o audio para aquele trecho', () => {
    const onSeek = jest.fn();
    render(<SyncedTranscript segments={segments} onSeek={onSeek} />);

    fireEvent.press(screen.getByLabelText('Ouvir a partir de 00:05'));

    expect(onSeek).toHaveBeenCalledWith(5_000);
  });

  it('toque longo abre a edicao daquele trecho', () => {
    const onEdit = jest.fn();
    render(<SyncedTranscript segments={segments} onEdit={onEdit} />);

    fireEvent(screen.getByLabelText('Ouvir a partir de 00:12'), 'longPress');

    expect(onEdit).toHaveBeenCalledWith(12_000);
  });

  it('mostra a janela de cinco linhas e o atalho para a transcricao completa', () => {
    const onOpen = jest.fn();
    render(<SyncedTranscript segments={segments} onOpen={onOpen} />);

    expect(screen.getByTestId('transcript-window')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Abrir transcrição completa'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
