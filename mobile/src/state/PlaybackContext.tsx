import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

interface PlaybackValue {
  /** Player unico do app (nota e transcricao usam o mesmo audio). */
  player: AudioPlayer;
  /** Fonte atual do player, para nao recarregar o mesmo audio ao trocar de tela. */
  sourceRef: { current: string | null };
}

const PlaybackContext = createContext<PlaybackValue | null>(null);

/**
 * Um unico player para todo o app. Dois players (um na nota, outro na
 * transcricao) sempre conflitavam: o audio parava e recomecava do zero. Com um
 * player so, a reproducao continua naturalmente entre as telas.
 */
// Atualiza o tempo com frequencia suficiente para a previa da transcricao.
const PLAYER_OPTIONS = { updateInterval: 250 };

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const [player] = useState(() => createAudioPlayer(undefined, PLAYER_OPTIONS));
  const sourceRef = useRef<string | null>(null);

  useEffect(() => () => player.release(), [player]);

  const value = useMemo<PlaybackValue>(() => ({ player, sourceRef }), [player]);

  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}

function usePlaybackValue(): PlaybackValue {
  const value = useContext(PlaybackContext);
  if (!value) throw new Error('PlaybackProvider ausente');
  return value;
}

export function usePlayback(): AudioPlayer {
  return usePlaybackValue().player;
}

/**
 * Aponta o player unico para `uri` e devolve ele. Trocar de fonte so acontece
 * quando a uri muda; a mesma fonte continua de onde estava (sem reiniciar).
 */
export function usePlaybackSource(uri: string | undefined): AudioPlayer {
  const { player, sourceRef } = usePlaybackValue();
  useEffect(() => {
    if (!uri || sourceRef.current === uri) return;
    sourceRef.current = uri;
    player.replace(uri);
  }, [player, sourceRef, uri]);
  return player;
}

/** Pausa o player unico (usado ao sair da nota). */
export function usePauseOnUnmount(): void {
  const player = usePlayback();
  useEffect(
    () => () => {
      try {
        player.pause();
      } catch {
        // player ja liberado
      }
    },
    [player],
  );
}
