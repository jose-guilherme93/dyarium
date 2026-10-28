import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { NoteAudioCard } from '@/components/NoteAudioCard';
import type { NoteAudioNode } from '@/core/noteDocument';
import type { TranscriptSegment } from '@/core/types';

const player = {
  currentTime: 10,
  duration: 120,
  currentStatus: { isLoaded: true },
  playing: false,
  isLoaded: true,
  pause: jest.fn(),
  play: jest.fn(),
  seekTo: jest.fn(() => Promise.resolve()),
  addListener: jest.fn(() => ({ remove: jest.fn() })),
};

let mockStatus = { playing: false, currentTime: 10, duration: 120, isLoaded: true };

jest.mock('expo-audio', () => ({
  useAudioPlayerStatus: () => mockStatus,
}));

jest.mock('@/services/audioFocus', () => ({
  requestAudioFocus: jest.fn(),
  releaseAudioFocus: jest.fn(),
}));

const node: NoteAudioNode = {
  kind: 'audio',
  id: 'a1',
  ref: 'local:a.aac',
  durationMs: 120_000,
};

const segments: TranscriptSegment[] = [
  { start_ms: 0, end_ms: 30_000, text: 'Primeira frase.' },
  { start_ms: 60_000, end_ms: 90_000, text: 'Frase do meio.' },
];

describe('NoteAudioCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStatus = { playing: false, currentTime: 10, duration: 120, isLoaded: true };
  });

  it('parado, tem um unico botao de play que inicia o audio', () => {
    const onPlay = jest.fn();
    render(<NoteAudioCard node={node} onPlay={onPlay} />);

    fireEvent.press(screen.getByLabelText('Tocar áudio'));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Tocar')).toBeNull();
  });

  it('tocando, o transporte e o unico controle do audio', () => {
    render(<NoteAudioCard node={node} active player={player as never} segments={segments} />);

    // O botao do card sai de cena: o play/pause fica so no transporte.
    expect(screen.queryByLabelText('Tocar áudio')).toBeNull();
    expect(screen.getByLabelText('Tocar')).toBeTruthy();
  });

  it('tocando, mantem a previa em texto quando nao ha segmentos', () => {
    render(
      <NoteAudioCard
        node={node}
        active
        player={player as never}
        transcript="texto transcrito"
        onOpenTranscript={jest.fn()}
      />,
    );

    expect(screen.getByTestId('audio-transcript').props.children).toBe('texto transcrito');
  });

  it('tocar numa linha da transcricao busca aquele trecho e toca', async () => {
    render(<NoteAudioCard node={node} active player={player as never} segments={segments} />);

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Ouvir a partir de 01:00'));
      await Promise.resolve();
    });

    expect(player.seekTo).toHaveBeenCalledWith(60);
    expect(player.play).toHaveBeenCalled();
  });

  it('parado, a onda toca o audio a partir do ponto tocado', () => {
    const onPlayFrom = jest.fn();
    render(<NoteAudioCard node={node} onPlayFrom={onPlayFrom} segments={segments} />);

    const wave = screen.getByLabelText('Ouvir a partir de');
    fireEvent(wave, 'layout', { nativeEvent: { layout: { width: 240, height: 34 } } });
    fireEvent(wave, 'responderGrant', { nativeEvent: { locationX: 60 } });
    fireEvent(wave, 'responderRelease', { nativeEvent: { locationX: 60 } });

    expect(onPlayFrom).toHaveBeenCalledWith(30_000);
  });

  it('a previa da transcricao abre a transcricao completa ao toque', () => {
    const onOpenTranscript = jest.fn();
    render(
      <NoteAudioCard
        node={node}
        transcript="texto transcrito"
        onOpenTranscript={onOpenTranscript}
      />,
    );

    fireEvent.press(screen.getByLabelText('Abrir transcrição completa'));

    expect(onOpenTranscript).toHaveBeenCalledTimes(1);
  });

  it('mostra o progresso da transcricao no proprio audio', () => {
    render(<NoteAudioCard node={node} transcribingPercent={42} />);

    expect(screen.getByTestId('audio-transcribing')).toBeTruthy();
    expect(screen.getByText('Transcrevendo 42%')).toBeTruthy();
  });

  it('sem andamento, ainda avisa que a transcricao esta em curso', () => {
    render(<NoteAudioCard node={node} transcribingWait />);

    expect(screen.getByText('Transcrevendo...')).toBeTruthy();
  });
});
