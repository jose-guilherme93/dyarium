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
import { seekPlayer } from '@/services/playback';

interface PlaybackValue {
  /** Player unico do app (nota e transcricao usam o mesmo audio). */
  player: AudioPlayer;
  /**
   * Aponta a fonte (so quando muda) e toca a partir de `seconds`.
   *
   * A troca de fonte e assincrona: `replace` a agenda e o `seekPlayer` espera
   * o status carregado antes de pedir a posicao. O AAC ADTS so tem o seek map
   * depois da preparacao, e um seek pedido antes disso era aceito e descartado
   * (a posicao voltava a 0). Quando a fonte ja e a atual, o seek e imediato.
   */
  playAt(uri: string, seconds: number): void;
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
  /** Fonte que ja foi apontada no player. */
  const loadedRef = useRef<string | null>(null);

  const playAt = useCallback(
    (uri: string, seconds: number) => {
      if (loadedRef.current !== uri) {
        // So troca a fonte quando ela muda: recarregar o mesmo audio o jogaria
        // de volta ao comeco.
        loadedRef.current = uri;
        player.replace(uri);
      }
      // `seekPlayer` espera a fonte ficar pronta antes de pular: buscar durante
      // o buffering fazia a posicao ser descartada quando o ADTS terminava de
      // abrir. O `replace` acima ja foi agendado antes.
      void seekPlayer(player, Math.max(0, Number.isFinite(seconds) ? seconds : 0), {
        autoplay: true,
      }).catch(() => undefined);
    },
    [player],
  );

  const value = useMemo<PlaybackValue>(() => ({ player, playAt }), [player, playAt]);

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

/** Aponta o audio do player e toca a partir de um instante (segundos). */
export function usePlayAt(): (uri: string, seconds: number) => void {
  return usePlaybackValue().playAt;
}

/**
 * Pausa o player unico (usado ao sair da nota).
 *
 * A pausa e adiada para o proximo tick do JS de proposito: `player.pause()` e
 * uma chamada **sincrona** do expo-audio (`AudioModule.pause`). Executada no
 * meio do desmonte, ela pode cair no dispatch de eventos do Fabric na thread
 * principal, e o `runOnMain` do modulo espera essa mesma thread: o app fica
 * "nao responde" por 5 s (ANR) ao sair da nota. Fora do desmonte, a chamada
 * roda na thread do JS e o `runOnMain` agenda a principal, que esta livre.
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
