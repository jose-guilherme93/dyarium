/**
 * Quem gravou a nota. O autor e um rotulo, nao uma entidade: o centro do mapa
 * e o dono do diario mesmo quando a nota esta marcada como "outros".
 */

import type { AuthorRole } from './types';

/** Resolve a escolha da nota contra o padrao da instancia. */
export function effectiveAuthor(
  author: AuthorRole | undefined,
  allNotesMine: boolean,
): AuthorRole {
  const value = author ?? '';
  if (value) return value;
  return allNotesMine ? 'self' : '';
}

/** Rotulo curto mostrado na nota e no grafo. */
export function authorLabel(
  author: AuthorRole | undefined,
  ownerName: string,
  allNotesMine: boolean,
): string {
  const role = effectiveAuthor(author, allNotesMine);
  const owner = ownerName.trim() || 'Você';
  switch (role) {
    case 'self':
      return owner;
    case 'other':
      return 'Outros';
    case 'mixed':
      return `${owner} e outros`;
    default:
      return 'Sem autor';
  }
}

/** Linha do prompt. O modelo so precisa saber como ler a primeira pessoa. */
export function authorPromptLine(
  author: AuthorRole | undefined,
  ownerName: string,
  allNotesMine = true,
): string {
  const role = effectiveAuthor(author, allNotesMine);
  const owner = ownerName.trim();
  switch (role) {
    case 'self':
      return owner
        ? `Autor do audio: ${owner} (o proprio autor do diario); a primeira pessoa no texto e ele.`
        : 'Autor do audio: o proprio autor do diario; a primeira pessoa no texto e ele.';
    case 'other':
      return owner
        ? `Autor do audio: outra pessoa, nao o autor do diario (${owner}); nao trate a primeira pessoa do texto como o autor.`
        : 'Autor do audio: outra pessoa, nao o autor do diario; nao trate a primeira pessoa do texto como o autor.';
    case 'mixed':
      return owner
        ? `Autor do audio: o autor do diario (${owner}) e outras pessoas; so atribua a primeira pessoa ao autor quando o texto deixar claro.`
        : 'Autor do audio: o autor do diario e outras pessoas; so atribua a primeira pessoa ao autor quando o texto deixar claro.';
    default:
      return 'Autor do audio: nao informado; nao assuma que a primeira pessoa do texto e o autor do diario.';
  }
}
