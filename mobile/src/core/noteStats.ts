/**
 * Contagens do texto da nota mostradas no menu de propriedades.
 *
 * Palavras, caracteres e bytes saem da mesma conversao para texto puro. Antes
 * o menu chamava `markdownToPlain` tres vezes (uma por `countWords`,
 * `countChars` e pelo tamanho), varrendo e alocando o corpo inteiro a cada
 * chamada. Uma nota longa abria o menu com tres passadas completas.
 */

import { utf8ByteLength } from './format';
import { markdownToPlain } from './richText';

export interface NoteStats {
  words: number;
  chars: number;
  /** Bytes UTF-8 do texto puro (sem marcadores), como o servidor conta. */
  bodyBytes: number;
}

export function noteStats(markdown: string): NoteStats {
  const plain = markdownToPlain(markdown);
  const trimmed = plain.trim();
  return {
    words: trimmed ? trimmed.split(/\s+/).length : 0,
    chars: plain.length,
    bodyBytes: utf8ByteLength(plain),
  };
}
