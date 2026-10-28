/**
 * Marca quando a tela da nota esta aberta.
 *
 * A nota e 100% local: abrir/editar nao pode disputar CPU, SQLite e rede com
 * sincronizacao em segundo plano. Enquanto ela esta visivel, os pulls do
 * servidor (lista e transcricoes) esperam; ao sair, o proximo ciclo retoma.
 */

let openNotes = 0;

export function enterNote(): void {
  openNotes += 1;
}

export function leaveNote(): void {
  openNotes = Math.max(0, openNotes - 1);
}

export function noteIsOpen(): boolean {
  return openNotes > 0;
}
