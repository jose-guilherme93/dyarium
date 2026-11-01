/**
 * Normaliza texto para busca: sem acento, sem caixa.
 *
 * O produto e em portugues; comparar so com `toLowerCase()` fazia "reuniao"
 * nao encontrar "Reunião" e "acao" nao encontrar "ação".
 */
export function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
