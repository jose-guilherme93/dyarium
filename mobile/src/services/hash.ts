// Hash SHA-256 incremental de arquivo: le em pedacos de 1 MiB para nao carregar
// o arquivo inteiro na memoria. Audios podem chegar a 2 GiB.
import { File, FileMode } from 'expo-file-system';
import { createSha256 } from '@/core/sha256';

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
      const n = Math.min(1024 * 1024, expected - total);
      const bytes = handle.readBytes(n);
      if (bytes.length === 0) {
        throw new Error('leitura interrompida');
      }
      if (bytes.length > n) {
        throw new Error('leitura devolveu mais bytes que o pedido');
      }
      hasher.update(bytes);
      total += bytes.length;
    }
    if (total !== expected) {
      throw new Error('total lido diferente do esperado');
    }
  } finally {
    handle.close();
  }
  return hasher.hex();
}
