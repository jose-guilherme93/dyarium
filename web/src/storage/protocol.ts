/**
 * Protocolo entre a pagina e o Worker que guarda o banco.
 *
 * A pagina nunca fala com o SQLite direto: manda `op` + `sql` + `params` e
 * recebe o valor. Assim existe um escritor so, e a UI nunca bloqueia no I/O.
 */

import type { RunResult } from "../../../mobile/src/core/schema";

export type Op = "exec" | "run" | "all" | "first";

export interface Request {
  id: number;
  op: Op;
  sql: string;
  params?: unknown[];
}

export type Reply =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string };

/**
 * O que o motor precisa entregar. No navegador e wa-sqlite sobre OPFS; no teste
 * e o `node:sqlite`, para rodar o SQL de verdade.
 */
export interface Engine {
  exec(sql: string): Promise<void>;
  run(sql: string, params: unknown[]): Promise<RunResult>;
  all<T = Record<string, unknown>>(sql: string, params: unknown[]): Promise<T[]>;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Executa um pedido e devolve a resposta no formato do protocolo. */
export async function handle(engine: Engine, request: Request): Promise<Reply> {
  const { id, op, sql, params = [] } = request;
  try {
    switch (op) {
      case "exec":
        await engine.exec(sql);
        return { id, ok: true, value: null };
      case "run":
        return { id, ok: true, value: await engine.run(sql, params) };
      case "all":
        return { id, ok: true, value: await engine.all(sql, params) };
      case "first": {
        const rows = await engine.all(sql, params);
        return { id, ok: true, value: rows[0] ?? null };
      }
      default:
        return { id, ok: false, error: `operacao desconhecida: ${String(op)}` };
    }
  } catch (error) {
    return { id, ok: false, error: messageOf(error) };
  }
}
