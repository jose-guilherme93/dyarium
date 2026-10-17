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
  /** Altura aproximada da linha do cursor. */
  lineHeight?: number;
  /** Margem no topo para a linha nao encostar na borda. */
  topInset?: number;
}

/**
 * Rolagem necessaria para a linha do cursor ficar visivel, ou `null` quando ela
 * ja esta (ou quando o alvo e a rolagem atual). Cobre os dois sentidos e, quando
 * precisa corrigir, coloca a linha no meio da area visivel: assim o cabecalho e
 * a barra/teclado nao cobrem o que esta sendo escrito.
 */
export function caretScrollTarget(input: CaretScrollInput): number | null {
  const lineHeight = input.lineHeight ?? 28;
  const topInset = input.topInset ?? 16;
  const caretBottom = input.editorTop + input.caret;
  const caretTop = caretBottom - lineHeight;
  const visibleTop = input.scrollY + topInset;
  const visibleBottom = input.scrollY + input.viewport - input.bottomInset;

  const outOfView = caretTop < visibleTop || caretBottom > visibleBottom;
  if (!outOfView) return null;

  // Centro da area entre o topo reservado e a barra de acoes/teclado.
  const center = topInset + (input.viewport - input.bottomInset - topInset) / 2;
  const target = Math.max(0, caretBottom - center);
  return target === input.scrollY ? null : target;
}
