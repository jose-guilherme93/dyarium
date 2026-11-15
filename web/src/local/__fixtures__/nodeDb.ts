/**
 * Banco de teste: o mesmo adaptador da web sobre o `node:sqlite`, ja migrado.
 *
 * Serve para exercitar a camada local em vitest com SQL de verdade, sem
 * navegador. Nao entra no bundle: so testes importam daqui.
 */

import { DatabaseSync } from "node:sqlite";

import { registerDatabase, registerDeviceIdentity } from "../../../../mobile/src/core/port";
import { applyMigrations } from "../../../../mobile/src/core/schema";

import { createDatabase, type Transport } from "../../storage/db";

function transport(raw: DatabaseSync): Transport {
  return {
    call: async (op, sql, params = []) => {
      if (op === "exec") {
        raw.exec(sql);
        return null;
      }
      if (op === "run") {
        const result = raw.prepare(sql).run(...(params as never[]));
        return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
      }
      const rows = raw.prepare(sql).all(...(params as never[])) as Record<string, unknown>[];
      return op === "first" ? (rows[0] ?? null) : rows;
    },
  };
}

/** Registra um cofre novo, em memoria, nas portas do nucleo. */
export async function registerNodeDatabase(): Promise<void> {
  const db = createDatabase(transport(new DatabaseSync(":memory:")));
  await applyMigrations(db, (task) => db.withTransactionAsync(task));
  registerDatabase(async () => db);
  registerDeviceIdentity(async () => ({ id: "dev_teste", name: "teste" }));
}
