/**
 * Classificacao de falhas de envio. Distingue o que vale a pena retentar (rede,
 * servidor fora) do que nao se resolve repetindo (o servidor recusa o que
 * recebeu). Sem isso, erros permanentes ficariam em retry infinito.
 */

import { ApiError } from './api';

/**
 * Erro permanente de upload: repetir nao muda o resultado (formato, tamanho,
 * integridade, entrada inexistente). Falha de rede nao e `ApiError`, e 408/429
 * continuam transitorios; os demais 5xx tambem.
 */
export function isPermanentUploadError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 408 || error.status === 429) return false;
  // O caderno pode estar subindo agora: o 422 invalid_notebook e temporario e
  // a proxima tentativa acerta. Tratar como permanente deixava a nota falha
  // para sempre por alguns milissegundos de corrida.
  if (error.code === 'invalid_notebook') return false;
  return error.status >= 400 && error.status < 500;
}
