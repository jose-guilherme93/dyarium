/**
 * Abre o cofre do navegador uma vez por pagina.
 *
 * A abertura e registrada de forma sincrona em `openWebDatabase`, entao a
 * primeira consulta da interface espera a mesma promessa em vez de correr na
 * frente do banco.
 */

import type { Database } from "../../../mobile/src/core/port";

import { openWebDatabase } from "../storage/db";

let opening: Promise<Database> | null = null;

export function connectLocal(): Promise<Database> {
  opening ??= openWebDatabase();
  return opening;
}
