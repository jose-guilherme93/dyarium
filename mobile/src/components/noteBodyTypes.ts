/**
 * Contrato do editor do corpo da nota.
 *
 * O corpo e uma lista de nos: texto rico, imagem e audio. O texto e editado
 * por um `EnrichedTextInput` nativo por no; imagem e audio sao blocos nativos
 * entre os textos. A tela da nota fala com o corpo por este contrato, sem
 * saber o que existe por tras.
 */

import type { AudioPlayer } from 'expo-audio';

import type { NoteInsertPosition } from '@/core/noteDocument';
import type { FormatType } from '@/core/richText';
import type { TranscriptSegment } from '@/core/types';

export type { FormatType };
export type { NoteInsertPosition };

export interface NoteBodyHandle {
  /** Foca o trecho de texto ativo (ou o primeiro). */
  focus(): void;
  /** Tira o foco do editor (fecha o teclado) antes de sair da tela. */
  blur(): void;
  /** Aplica formatacao no trecho ativo. */
  format(type: FormatType): void;
  /** Insere uma foto no cursor, dividindo o trecho de texto. */
  insertImage(
    displaySrc: string,
    persistSrc: string,
    alt: string,
    widthPercent?: number,
    naturalWidth?: number,
    naturalHeight?: number,
  ): void;
  /** Remove uma foto que ainda nao terminou de entrar na nota. */
  removeImage(persistSrc: string): void;
  /** Insere um audio no cursor, dividindo o trecho de texto. */
  insertAudio(ref: string, durationMs?: number): void;
  /** Coloca um link no texto selecionado do trecho ativo. */
  insertLink(url: string): void;
  /** Onde o proximo no deve entrar (null quando nao ha cursor de texto). */
  getInsertPosition(): NoteInsertPosition | null;
  /** Entrega o markdown atual (a edicao ja e enviada no debounce). */
  flush(): Promise<void>;
}

export interface NoteBodyProps {
  value: string;
  onChangeMarkdown: (markdown: string) => void;
  /** Mapa referencia salva -> fonte de exibicao (arquivo local ou URL). */
  imageSources?: Record<string, string>;
  /** Fotos que ainda estao sendo preparadas/gravadas, por referencia. */
  imageLoading?: Record<string, boolean>;
  /** Transcricao de cada audio, por referencia. */
  audioTranscripts?: Record<string, string>;
  /** Segmentos com minutagem de cada audio, por referencia. */
  audioSegments?: Record<string, TranscriptSegment[]>;
  /** Referencia do audio que esta no player. */
  activeAudioRef?: string | null;
  /** Player unico do app: o card de audio nao cria player proprio. */
  audioPlayer?: AudioPlayer | null;
  /** Trecho inicial do audio ativo, quando a reproducao veio da transcricao. */
  audioStartMs?: number | null;
  /**
   * Referencias do audio da propria nota (pode aparecer como `local:` ou como
   * `attachment:`). So ele tem transcricao completa e recebe o progresso.
   */
  ownAudioRefs?: string[];
  /** Transcricao da propria nota: fallback quando a referencia do no nao casa. */
  ownTranscript?: string;
  /** Segmentos da propria nota: mesmo fallback da transcricao. */
  ownSegments?: TranscriptSegment[];
  /** Transcricao pedida e ainda sem andamento (ex.: feita no servidor). */
  transcribingWait?: boolean;
  /** Progresso (0..100) da transcricao local da nota, enquanto ela roda. */
  transcribingPercent?: number;
  /** Ha audio sem transcricao e modelo local disponivel? */
  canTranscribe?: boolean;
  /** Inicia a transcricao local da nota. */
  onTranscribe?: () => void;
  /** Para a transcricao local em andamento. */
  onStopTranscribe?: () => void;
  /** Toca um audio do corpo (do inicio ou de um trecho). */
  onPlayAudio?: (ref: string, startMs?: number) => void;
  /** Abre a transcricao completa da nota. */
  onOpenTranscript?: () => void;
  /** Abre a edicao de um trecho da transcricao completa. */
  onEditTranscript?: (startMs: number) => void;
  typography?: import('@/core/typography').NoteTypography;
  /** Abre a foto em tela cheia. */
  onImageOpen?: (src: string) => void;
  placeholder?: string;
}
