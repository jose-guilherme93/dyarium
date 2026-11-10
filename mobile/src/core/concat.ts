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
  /**
   * Cede a thread de JS entre pedacos. Sem isso a copia inteira roda numa
   * cadeia de microtasks e a interface congela durante a concatenacao de uma
   * gravacao longa (uma hora de audio = ~230 pedacos de 1 MiB).
   */
  yieldToUI?(): Promise<void>;
}

/** Cede a thread a cada N pedacos: 8 MiB, o suficiente para nao pesar e para
 *  a interface respirar durante uma concatenacao longa. */
const YIELD_EVERY_CHUNKS = 8;

const defaultYieldToUI = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/** Cabecalho ADTS: sync word (12 bits = 0xFFF) nos dois primeiros bytes. */
export function isAdtsHeader(first: number, second: number): boolean {
  return first === 0xff && (second & 0xf0) === 0xf0;
}

/**
 * Concatena todos os segmentos de `dir` em `outPath`, na ordem lexicografica
 * (os nomes sao zero-padded: seg-000, seg-001, ...). Retorna o total de bytes.
 *
 * Falha explicitamente (sem `break` silencioso) se algum segmento estiver
 * truncado, vazio, ou se o IO devolver bytes a mais ou a menos que o pedido.
 */
export async function concatenateSegments(
  dir: string,
  outPath: string,
  io: ConcatIO,
  chunkSize = 1 << 20,
): Promise<number> {
  if (chunkSize <= 0) throw new Error('chunkSize deve ser positivo');
  const segments = (await io.listSegments(dir)).slice().sort();
  const sizes: Record<string, number> = {};
  let expectedTotal = 0;
  for (const segment of segments) {
    const size = await io.size(segment);
    if (size <= 0) throw new Error('segmento vazio ou invalido: ' + segment);
    sizes[segment] = size;
    expectedTotal += size;
  }
  let total = 0;
  let chunks = 0;
  for (const segment of segments) {
    const size = sizes[segment];
    let offset = 0;
    while (offset < size) {
      const length = Math.min(chunkSize, size - offset);
      const bytes = await io.read(segment, offset, length);
      if (bytes.length === 0) throw new Error('segmento truncado: ' + segment);
      if (bytes.length > length) throw new Error('leitura excedeu o solicitado: ' + segment);
      await io.append(outPath, bytes);
      offset += bytes.length;
      total += bytes.length;
      chunks++;
      if (chunks % YIELD_EVERY_CHUNKS === 0) {
        await (io.yieldToUI ?? defaultYieldToUI)();
      }
    }
  }
  if (total !== expectedTotal) throw new Error('total de bytes nao confere com os segmentos');
  return total;
}
