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
