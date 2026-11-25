/**
 * Recarregar o documento. Fica isolado para o teste do fluxo de saida nao
 * depender da navegacao do jsdom, que nao existe fora do navegador.
 */
export function reloadPage(): void {
  window.location.reload();
}
