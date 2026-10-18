/**
 * Regras de tamanho de imagem. Puro e testavel: a manipulacao nativa (redimensionar
 * e recomprimir) fica no servico, aqui so a decisao do alvo.
 */

/** Maior lado da imagem guardada. Acima disso o decode no editor fica lento. */
export const MAX_IMAGE_DIMENSION = 2048;

/** Qualidade ao recomprimir em JPEG (visualmente sem perda em tela de celular). */
export const IMAGE_QUALITY = 0.9;

/**
 * Alvo de redimensionamento para caber em `max` no maior lado, preservando a
 * proporcao. Devolve `null` quando a imagem ja cabe (nunca aumenta).
 */
export function resizeTarget(
  width: number,
  height: number,
  max: number = MAX_IMAGE_DIMENSION,
): { width: number; height: number } | null {
  if (width <= 0 || height <= 0) return null;
  const longest = Math.max(width, height);
  if (longest <= max) return null;
  if (width >= height) {
    return { width: max, height: Math.max(1, Math.round((height * max) / width)) };
  }
  return { width: Math.max(1, Math.round((width * max) / height)), height: max };
}

/** Opcao de largura oferecida ao inserir uma foto na nota. */
export interface ImageWidthOption {
  /** Rotulo em pt-BR, exibido no seletor de tamanho. */
  label: string;
  /** Percentual da largura da nota (100 = largura total). */
  percent: number;
}

/** Tamanhos predefinidos da foto dentro da nota, do maior ao menor. */
export const IMAGE_WIDTH_OPTIONS: ImageWidthOption[] = [
  { label: 'Largura total', percent: 100 },
  { label: 'Metade da largura', percent: 50 },
  { label: 'Miniatura', percent: 30 },
];

/**
 * Largura padrao de uma foto recem-inserida: metade da nota ("tamanho medio").
 * Foto em largura total empurrava o paragrafo editavel para fora da tela.
 */
export const DEFAULT_IMAGE_WIDTH = 50;

/** Maior largura que a foto pode ocupar (percentual da nota). */
export const IMAGE_WIDTH_MIN = 15;

/** Mantem a largura da foto dentro da faixa segura (miniatura ate total). */
export function clampImageWidth(percent: number): number {
  if (!Number.isFinite(percent)) return 100;
  return Math.min(100, Math.max(IMAGE_WIDTH_MIN, Math.round(percent)));
}
