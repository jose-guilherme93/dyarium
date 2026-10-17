/**
 * Geometria do teclado na tela da nota.
 *
 * No Android, com `adjustResize`, a janela encolhe quando o teclado abre; com
 * edge-to-edge (padrao do SDK novo), a janela continua do mesmo tamanho e o
 * teclado cobre a parte de baixo. A tela precisa saber quanto do teclado NAO foi
 * absorvido para levantar a barra de acoes e reservar esse espaco no fim da nota
 * — sem isso o cursor fica embaixo do teclado e nao da para ver o que se escreve.
 */

/**
 * Parte da altura do teclado que a janela nao absorveu (edge-to-edge). Com
 * `adjustResize`, a janela encolhe e o resultado e 0.
 */
export function keyboardOverlap(
  keyboardHeight: number,
  baseHeight: number,
  windowHeight: number,
): number {
  const absorbed = Math.max(0, baseHeight - windowHeight);
  return Math.max(0, keyboardHeight - absorbed);
}

export interface CaretScrollInput {
  /** Posicao do cursor (limite inferior) dentro do editor. */
  caret: number;
  /** Posicao do topo do editor no conteudo da nota. */
  editorTop: number;
  /** Rolagem atual da nota. */
  scrollY: number;
  /** Altura visivel acima do teclado. */
  viewport: number;
  /** Espaco reservado no rodape (barra de acoes e margem). */
  bottomInset: number;
}

/**
 * Rolagem necessaria para o cursor ficar acima do teclado, ou `null` quando ja
 * esta visivel. O alvo nunca e negativo.
 */
export function caretScrollTarget(input: CaretScrollInput): number | null {
  const caretBottom = input.editorTop + input.caret;
  const limit = input.viewport - input.bottomInset;
  if (caretBottom <= input.scrollY + limit) {
    return null;
  }
  return Math.max(0, caretBottom - limit);
}
