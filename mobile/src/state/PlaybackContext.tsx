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

/**
 * Um unico player para todo o app. Dois players (nota e transcricao) sempre
 * conflitavam: o audio parava e recomecava do zero.
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

/**
 * Aponta o player unico para `uri` e carrega na hora. Usado quando a pessoa
 * escolhe um audio (tocar ou pular para um trecho); abrir a nota continua sem
 * decodificar audio.
 */
export function usePlaySource(): (uri: string) => void {
  const { desiredRef, load } = usePlaybackValue();
  return useCallback(
    (uri: string) => {
      desiredRef.current = uri;
      load();
    },
    [desiredRef, load],
  );
}

interface PlaybackSourceOptions {
  /** Carrega sem esperar (a tela de transcricao precisa do audio pronto). */
  immediate?: boolean;
}

/**
 * Aponta o player unico para `uri` e devolve ele. Por padrao a fonte NAO e
 * carregada: abrir uma nota nao pode decodificar audio. Quem precisa do audio
 * pronto (tela de transcricao) passa `immediate`; a nota carrega no play/seek.
 */
export function usePlaybackSource(uri: string | undefined, options?: PlaybackSourceOptions): AudioPlayer {
  const { player, desiredRef, load } = usePlaybackValue();
  const immediate = options?.immediate ?? false;

  useEffect(() => {
    if (!uri) return undefined;
    desiredRef.current = uri;
    if (immediate) load();
    return undefined;
  }, [uri, desiredRef, load, immediate]);

  return player;
}

/**
 * Pausa o player unico (usado ao sair da nota).
 *
 * A pausa e adiada para o proximo tick do JS de proposito: `player.pause()` e
 * uma chamada **sincrona** do expo-audio (`AudioModule.pause`). Executada no
 * meio do desmonte, ela pode cair no dispatch de eventos do Fabric na thread
 * principal, e o `runOnMain` do modulo espera essa mesma thread: o app fica
 * "nao responde" por 5 s (ANR) ao sair da nota. Fora do desmonte, a chamada
 * roda na thread do JS e o `runOnMain` agenda na principal, que esta livre.
 */
export function usePauseOnUnmount(): void {
  const player = usePlayback();
  useEffect(
    () => () => {
      setTimeout(() => {
        try {
          player.pause();
        } catch {
          // player ja liberado
        }
      }, 0);
    },
    [player],
  );
}
