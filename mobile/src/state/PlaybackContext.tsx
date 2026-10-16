import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { bumpRender } from '@/dev/perf';

interface PlaybackValue {
  /** Player unico do app (nota e transcricao usam o mesmo audio). */
  player: AudioPlayer;
  /** Fonte desejada (a nota aberta). */
  desiredRef: { current: string | null };
  /** Fonte que ja foi carregada no player. */
  loadedRef: { current: string | null };
  /** Carrega a fonte desejada agora (se ainda nao estiver carregada). */
  load(): void;
}

const PlaybackContext = createContext<PlaybackValue | null>(null);

// Atualiza o tempo com frequencia suficiente para a previa da transcricao.
const PLAYER_OPTIONS = { updateInterval: 250 };
// Abrir a nota carrega so o texto; o audio entra depois (ou ao apertar play).
const LOAD_DELAY_MS = 900;

/**
 * Um unico player para todo o app. Dois players (nota e transcricao) sempre
 * conflitavam: o audio parava e recomecava do zero. A fonte so e carregada
 * depois que a nota ja abriu, para a abertura nao travar.
 */
export function PlaybackProvider({ children }: { children: ReactNode }) {
  const [player] = useState(() => createAudioPlayer(undefined, PLAYER_OPTIONS));
  const desiredRef = useRef<string | null>(null);
  const loadedRef = useRef<string | null>(null);

  const load = useCallback(() => {
    const uri = desiredRef.current;
    if (!uri || loadedRef.current === uri) return;
    loadedRef.current = uri;
    player.replace(uri);
  }, [player]);

  useEffect(() => () => player.release(), [player]);

  const value = useMemo<PlaybackValue>(
    () => ({ player, desiredRef, loadedRef, load }),
    [player, load],
  );

  useEffect(() => {
    bumpRender('playback.value');
  }, [value]);

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

/** Carrega a fonte desejada agora (usar antes de tocar/seek). */
export function useLoadPlayback(): () => void {
  return usePlaybackValue().load;
}

interface PlaybackSourceOptions {
  /** Carrega sem esperar (a tela de transcricao precisa do audio pronto). */
  immediate?: boolean;
}

/**
 * Aponta o player unico para `uri` e devolve ele. A carga e adiada por
 * `LOAD_DELAY_MS` (a menos que `immediate`), e so acontece quando a uri muda.
 */
export function usePlaybackSource(uri: string | undefined, options?: PlaybackSourceOptions): AudioPlayer {
  const { player, desiredRef, load } = usePlaybackValue();
  const immediate = options?.immediate ?? false;

  useEffect(() => {
    if (!uri) return undefined;
    desiredRef.current = uri;
    if (immediate) {
      load();
      return undefined;
    }
    const timer = setTimeout(load, LOAD_DELAY_MS);
    return () => clearTimeout(timer);
  }, [uri, desiredRef, load, immediate]);

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
