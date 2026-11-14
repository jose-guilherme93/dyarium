/**
 * Marca quando uma tela interativa de tela cheia esta aberta (nota ou mapa).
 *
 * Essas telas sao locais e o usuario esta mexendo nelas agora: abrir/editar,
 * arrastar bolas. Sincronizacao de fundo (rede, `SELECT *` da biblioteca,
 * reconciliacao) nao pode disputar a thread de JS com o gesto; quando a tela
 * fecha, o proximo ciclo retoma.
 */

let openNotes = 0;
let interactiveViews = 0;

export function enterNote(): void {
  openNotes += 1;
}

export function leaveNote(): void {
  openNotes = Math.max(0, openNotes - 1);
}

export function noteIsOpen(): boolean {
  return openNotes > 0;
}

/** Mapa e outras superficies de tela cheia que rodam fisica/desenho. */
export function enterInteractiveView(): void {
  interactiveViews += 1;
}

export function leaveInteractiveView(): void {
  interactiveViews = Math.max(0, interactiveViews - 1);
}

/** Verdadeiro quando o trabalho de fundo deve esperar. */
export function backgroundPaused(): boolean {
  return openNotes > 0 || interactiveViews > 0;
}
