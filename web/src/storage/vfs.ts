/**
 * Escolha do VFS do SQLite no navegador.
 *
 * O banco normal usa OPFS. Quando o navegador recusa (politica de
 * armazenamento, handle indisponivel), o mesmo banco vai para o IndexedDB.
 * O nome do IndexedDB do SQLite e separado do cache do app (`dyarium`, em
 * `lib/idb`): dividir o mesmo banco faz o `indexedDB.open` falhar com
 * VersionError, porque as versoes nao batem.
 */

/** Nome do IndexedDB do banco SQLite; nunca igual ao cache do app. */
export const SQLITE_IDB_NAME = "dyarium-sqlite";

/**
 * Tenta a via principal; qualquer falha (inclusive na abertura) cai na reserva.
 * Nao engole a reserva: se ela tambem falhar, o erro dela chega ao worker.
 */
export async function comReserva<T>(
  principal: () => Promise<T>,
  reserva: () => Promise<T>,
): Promise<T> {
  try {
    return await principal();
  } catch {
    return reserva();
  }
}
