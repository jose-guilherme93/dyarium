/**
 * O minimo do editor que a remocao precisa. O BlockNote raso nao tem audio
 * quando a nota nunca passou pelo dashboard, entao a funcao e pura o bastante
 * para ser testada sem montar a interface.
 */
/**
 * Remove do documento os blocos de audio do anexo. Devolve `true` quando havia
 * algum: quem chama usa isso para saber se o marcador tambem saiu do markdown.
 */
export function removeAudioBlocks<T extends { type: string; props: object }>(
  editor: {
    document: T[];
    removeBlocks: (blocks: T[]) => void;
  },
  attachmentId: string,
): boolean {
  const doomed = editor.document.filter(
    (block) =>
      block.type === "audio" &&
      (block.props as { attachmentId?: string }).attachmentId === attachmentId,
  );
  if (doomed.length === 0) {
    return false;
  }
  editor.removeBlocks(doomed);
  return true;
}
