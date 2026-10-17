/**
 * Markdown da nota em blocos do editor, sem depender de um editor criado.
 *
 * O editor do dashboard ja tem o BlockNote em maos (ele precisa para editar); a
 * unica coisa que exige o editor e a conversao oficial. Aqui, para quem so precisa
 * **ler** o markdown (contagem de palavras, diff do historico, o editor na
 * montagem inicial), a mesma conversao roda uma vez e o resultado fica em cache.
 *
 * Por que o cache: o `NoteEditor` pode montar varias vezes na sessao e o
 * conversor do BlockNote nao e barato. O cache e por markdown, entao abrir a mesma
 * nota de novo nao paga a conversao duas vezes.
 */

import { blocknoteMarkdownToBlocks } from "./blocknoteMarkdown";

const cache = new Map<string, ReturnType<typeof blocknoteMarkdownToBlocks>>();

/** Blocos do editor para um corpo em markdown (resultado compartilhado). */
export function markdownToNoteBlocks(markdown: string): ReturnType<typeof blocknoteMarkdownToBlocks> {
  const hit = cache.get(markdown);
  if (hit) {
    return hit;
  }
  const blocks = blocknoteMarkdownToBlocks(markdown);
  // Guarda so o que cabe: markdown gigante nao deve virar memoria.
  if (cache.size > 50) {
    cache.clear();
  }
  cache.set(markdown, blocks);
  return blocks;
}

/** Limpa o cache (usado nos testes). */
export function resetMarkdownCache(): void {
  cache.clear();
}