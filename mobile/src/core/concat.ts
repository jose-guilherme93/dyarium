/**
 * Concatenacao de segmentos AAC ADTS por copia de bytes. O ADTS e um fluxo de
 * quadros sem container, entao juntar os arquivos em ordem produz um arquivo
 * valido (e robusto a truncamento).
 *
 * O IO e injetado (seam) para permitir testes com um filesystem em memoria.
 */

export interface ConcatIO {
  /** Lista os segmentos da sessao (pode vir em qualquer ordem). */
  listSegments(dir: string): Promise<string[]>;
  /** Tamanho de um arquivo em bytes. */
  size(path: string): Promise<number>;
  /** Le `length` bytes a partir de `offset`. */
  read(path: string, offset: number, length: number): Promise<Uint8Array>;
  /** Acrescenta bytes ao arquivo de saida. */
  append(outPath: string, bytes: Uint8Array): Promise<void>;
}

/**
 * Concatena todos os segmentos de `dir` em `outPath`, na ordem lexicografica
 * (os nomes sao zero-padded: seg-000, seg-001, ...). Retorna o total de bytes.
 */
export async function concatenateSegments(
  dir: string,
  outPath: string,
  io: ConcatIO,
  chunkSize = 1 << 20,
): Promise<number> {
  if (chunkSize <= 0) throw new Error('chunkSize deve ser positivo');
  const segments = (await io.listSegments(dir)).slice().sort();
  let total = 0;
  for (const segment of segments) {
    const size = await io.size(segment);
    let offset = 0;
    while (offset < size) {
      const length = Math.min(chunkSize, size - offset);
      const bytes = await io.read(segment, offset, length);
      if (bytes.length === 0) break; // evita loop infinito em IO defeituoso
      await io.append(outPath, bytes);
      offset += bytes.length;
      total += bytes.length;
    }
  }
  return total;
}
