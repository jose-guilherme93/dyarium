// Hash SHA-256 incremental de arquivo: le em pedacos para nao carregar o
// arquivo inteiro na memoria nem segurar a thread de JS. Audios podem chegar a
// 2 GiB; hashear tudo de uma vez travava o toque por segundos a cada envio.
import { File, FileMode } from 'expo-file-system';
import { createSha256 } from '@/core/sha256';

/** Tamanho do pedaco lido por vez (meio MiB cabe no orcamento de um quadro). */
const CHUNK_BYTES = 512 * 1024;

/** Devolve a thread para a interface entre um pedaco e outro. */
function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function fileSha256(path: string): Promise<string> {
  const file = new File(path);
  if (!file.exists) {
    throw new Error('arquivo nao encontrado');
  }

  const expected = file.size;
  if (expected <= 0) {
    throw new Error('arquivo vazio ou tamanho invalido');
  }

  const handle = file.open(FileMode.ReadOnly);
  const hasher = createSha256();
  let total = 0;
  try {
    while (total < expected) {
      const n = Math.min(CHUNK_BYTES, expected - total);
      const bytes = handle.readBytes(n);
      if (bytes.length === 0) {
        throw new Error('leitura interrompida');
      }
      if (bytes.length > n) {
        throw new Error('leitura devolveu mais bytes que o pedido');
      }
      hasher.update(bytes);
      total += bytes.length;
      // Cede a thread: o toque na home e a navegacao continuam respondendo
      // enquanto um audio grande sobe.
      await yieldToUI();
    }
    if (total !== expected) {
      throw new Error('total lido diferente do esperado');
    }
  } finally {
    handle.close();
  }
  return hasher.hex();
}
