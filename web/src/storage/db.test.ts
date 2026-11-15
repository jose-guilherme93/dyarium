import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";

import { applyMigrations, LATEST_SCHEMA_VERSION } from "../../../mobile/src/core/schema";

import { createDatabase, type Transport } from "./db";
import type { Op } from "./protocol";

/** Transporte que so anota o que passou, na ordem. */
function registro(): { transport: Transport; calls: string[] } {
  const calls: string[] = [];
  const transport: Transport = {
    call: async (op: Op, sql: string) => {
      calls.push(`${op}:${sql}`);
      await Promise.resolve();
      if (op === "run") return { changes: 1, lastInsertRowId: 1 };
      if (op === "first") return null;
      if (op === "all") return [];
      return null;
    },
  };
  return { transport, calls };
}

describe("banco do navegador", () => {
  it("serializa duas transacoes, sem intercalar", async () => {
    const { transport, calls } = registro();
    const db = createDatabase(transport);

    await Promise.all([
      db.withTransactionAsync(async () => {
        await db.runAsync("INSERT a");
        await db.runAsync("INSERT b");
      }),
      db.withTransactionAsync(async () => {
        await db.runAsync("INSERT c");
      }),
    ]);

    expect(calls).toEqual([
      "exec:BEGIN",
      "run:INSERT a",
      "run:INSERT b",
      "exec:COMMIT",
      "exec:BEGIN",
      "run:INSERT c",
      "exec:COMMIT",
    ]);
  });

  it("chamada de fora espera a transacao terminar", async () => {
    const { transport, calls } = registro();
    const db = createDatabase(transport);

    let liberar!: () => void;
    const porta = new Promise<void>((resolve) => {
      liberar = resolve;
    });

    const transacao = db.withTransactionAsync(async () => {
      await porta;
      await db.runAsync("INSERT dentro");
    });
    const leitura = db.getAllAsync("SELECT fora");
    liberar();
    await Promise.all([transacao, leitura]);

    expect(calls.indexOf("all:SELECT fora")).toBeGreaterThan(calls.indexOf("exec:COMMIT"));
  });

  it("erro dentro da transacao desfaz e propaga", async () => {
    const { transport, calls } = registro();
    const db = createDatabase(transport);

    await expect(
      db.withTransactionAsync(async () => {
        await db.runAsync("INSERT x");
        throw new Error("falhou");
      }),
    ).rejects.toThrow("falhou");

    expect(calls).toContain("exec:ROLLBACK");
    expect(calls).not.toContain("exec:COMMIT");
  });

  it("fila continua andando depois de um erro", async () => {
    const { transport } = registro();
    const db = createDatabase(transport);
    await expect(db.getFirstAsync("SELECT falha")).resolves.toBeNull();
    await expect(db.getAllAsync("SELECT ok")).resolves.toEqual([]);
  });

  it("aplica as migracoes do nucleo no SQL de verdade", async () => {
    const raw = new DatabaseSync(":memory:");
    const transport: Transport = {
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
    const db = createDatabase(transport);

    await applyMigrations(db, (task) => db.withTransactionAsync(task));

    const versao = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
    expect(versao?.user_version).toBe(LATEST_SCHEMA_VERSION);

    const notas = await db.getAllAsync<{ id: string }>("SELECT id FROM recordings LIMIT 5");
    expect(Array.isArray(notas)).toBe(true);

    const tabelas = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'entry_sync'",
    );
    expect(tabelas).toHaveLength(1);
  });
});
