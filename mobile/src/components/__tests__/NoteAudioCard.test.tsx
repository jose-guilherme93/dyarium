import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

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

/** Altura aplicada ao container do card: o que a nota reserva na lista. */
function cardHeight(result: ReturnType<typeof render>): number | undefined {
  const style = StyleSheet.flatten(result.getByTestId('audio-card').props.style);
  return style?.height;
}

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

  it('buscando o anexo, o play vira giro e nao dispara outra busca', () => {
    const onPlay = jest.fn();
    render(<NoteAudioCard node={node} onPlay={onPlay} loading />);

    expect(screen.getByTestId('audio-loading')).toBeTruthy();
    expect(screen.queryByLabelText('Tocar áudio')).toBeNull();
  });

  it('anexo que falhou vira aviso e o toque tenta de novo', () => {
    const onPlay = jest.fn();
    render(<NoteAudioCard node={node} onPlay={onPlay} loadFailed />);

    fireEvent.press(screen.getByLabelText('Tentar abrir o áudio de novo'));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Tocar áudio')).toBeNull();
  });

  it('tocando, o transporte e o unico controle do audio', () => {
    render(<NoteAudioCard node={node} active player={player as never} segments={segments} />);

    // O botao do card sai de cena: o play/pause fica so no transporte.
    expect(screen.queryByLabelText('Tocar áudio')).toBeNull();
    expect(screen.getByLabelText('Tocar')).toBeTruthy();
    // No lugar dele, so a indicacao de que este audio esta no player.
    expect(screen.getByTestId('audio-indicator', { includeHiddenElements: true })).toBeTruthy();
  });

  it('tocando, o topo mostra a posicao e a duracao', () => {
    render(<NoteAudioCard node={node} active player={player as never} />);

    expect(screen.getByText('00:10 / 02:00')).toBeTruthy();
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

  it('nao mostra as linhas sincronizadas dentro do card', () => {
    render(<NoteAudioCard node={node} active player={player as never} segments={segments} />);

    // A transcricao sincronizada vive atras de `onOpenTranscript`; o card fica
    // com a previa, a onda e o transporte.
    expect(screen.queryByLabelText('Ouvir a partir de 01:00')).toBeNull();
    expect(screen.getByLabelText('Posição do áudio')).toBeTruthy();
  });

  it('tocando, a onda do card busca o ponto no player', async () => {
    render(<NoteAudioCard node={node} active player={player as never} segments={segments} />);

    const wave = screen.getByLabelText('Posição do áudio');
    fireEvent(wave, 'layout', { nativeEvent: { layout: { width: 240, height: 40 } } });
    await act(async () => {
      fireEvent(wave, 'responderGrant', { nativeEvent: { locationX: 120 } });
      fireEvent(wave, 'responderRelease', { nativeEvent: { locationX: 120 } });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(player.seekTo).toHaveBeenCalledWith(60);
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

  it('mantem 182 dp de altura em todos os estados', () => {
    const states = [
      <NoteAudioCard key="sem-transcricao" node={node} />,
      <NoteAudioCard
        key="transcrevendo"
        node={node}
        transcribingPercent={42}
        canTranscribe
        onTranscribe={jest.fn()}
      />,
      <NoteAudioCard key="com-transcricao" node={node} transcript="texto transcrito" />,
      <NoteAudioCard
        key="tocando"
        node={node}
        active
        player={player as never}
        transcript="texto transcrito"
        segments={segments}
      />,
      <NoteAudioCard
        key="erro"
        node={node}
        transcribeError
        canTranscribe
        onTranscribe={jest.fn()}
      />,
    ];

    for (const element of states) {
      const view = render(element);
      expect(cardHeight(view)).toBe(182);
      view.unmount();
    }
  });

  it('mostra "Sem transcrição" so quando nao ha transcricao', () => {
    const withoutTranscript = render(<NoteAudioCard node={node} />);
    expect(withoutTranscript.getByTestId('audio-empty')).toBeTruthy();
    expect(withoutTranscript.getByText('Sem transcrição')).toBeTruthy();
    withoutTranscript.unmount();

    const withTranscript = render(<NoteAudioCard node={node} transcript="texto transcrito" />);
    expect(withTranscript.queryByTestId('audio-empty')).toBeNull();
    expect(withTranscript.queryByText('Sem transcrição')).toBeNull();
  });

  it('mostra a previa da transcricao em tres linhas de 19', () => {
    render(<NoteAudioCard node={node} transcript="texto transcrito" />);

    const preview = screen.getByTestId('audio-transcript');
    expect(preview.props.numberOfLines).toBe(3);
    expect(StyleSheet.flatten(preview.props.style)?.lineHeight).toBe(19);
  });

  it('mostra o progresso da transcricao no proprio audio', () => {
    render(<NoteAudioCard node={node} transcribingPercent={42} />);

    expect(screen.getByTestId('audio-transcribing')).toBeTruthy();
    expect(screen.getByText('Transcrevendo 42%')).toBeTruthy();
    // A barra de 2 dp fica dentro da faixa de texto, sem crescer o card.
    expect(screen.getByTestId('audio-transcribing-progress')).toBeTruthy();
    expect(screen.queryByTestId('audio-empty')).toBeNull();
  });

  it('sem andamento, ainda avisa que a transcricao esta em curso', () => {
    render(<NoteAudioCard node={node} transcribingWait />);

    expect(screen.getByText('Transcrevendo no servidor')).toBeTruthy();
  });

  it('no erro da transcricao, mostra o aviso e o tentar de novo', () => {
    const retry = jest.fn();
    render(<NoteAudioCard node={node} transcribeError canTranscribe onTranscribe={retry} />);

    expect(screen.getByTestId('audio-transcribe-error')).toBeTruthy();
    expect(screen.getByText('Falha na transcrição')).toBeTruthy();
    expect(screen.queryByTestId('audio-empty')).toBeNull();

    fireEvent.press(screen.getByLabelText('Tentar de novo'));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
