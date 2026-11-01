/** Abre o HTML do livro numa janela e imprime depois que as fontes carregarem.
 *  Sem esperar a Newsreader, o PDF sairia com a fonte de reserva e as quebras
 *  nao bateriam com as guias da folha. O conteudo e gerado aqui, entao a janela
 *  pode ser acessada para disparar a impressao (com `noopener` o navegador
 *  devolve null e o botao nao faria nada). */
export function printHtmlDocument(html: string): void {
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (!win) {
    URL.revokeObjectURL(url);
    return;
  }
  const print = () => {
    win.focus();
    win.print();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  win.addEventListener("load", () => {
    const fonts = win.document.fonts;
    if (fonts?.ready) {
      void fonts.ready.then(print).catch(print);
    } else {
      print();
    }
  });
}
