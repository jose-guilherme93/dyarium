import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";

import { handle, type Engine, type Request } from "./protocol";

/** Motor de teste: SQL de verdade em memoria, sem navegador. */
function nodeEngine(db: DatabaseSync): Engine {
  return {
    exec: async (sql) => {
      db.exec(sql);
    },
    run: async (sql, params) => {
      const result = db.prepare(sql).run(...(params as never[]));
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    all: async (sql, params) => db.prepare(sql).all(...(params as never[])) as never,
  };
}

function pedido(over: Partial<Request>): Request {
  return { id: 1, op: "all", sql: "SELECT 1", ...over };
}

describe("protocolo do banco", () => {
  let db: DatabaseSync;
  let engine: Engine;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    engine = nodeEngine(db);
  });

  it("executa DDL e devolve nulo", async () => {
    const reply = await handle(engine, pedido({ op: "exec", sql: "CREATE TABLE t (a TEXT)" }));
    expect(reply).toEqual({ id: 1, ok: true, value: null });
  });

  it("liga parametros e devolve changes", async () => {
    db.exec("CREATE TABLE t (a TEXT, b INTEGER)");
    const reply = await handle(
      engine,
      pedido({ op: "run", sql: "INSERT INTO t (a,b) VALUES (?,?)", params: ["x", 2] }),
    );
    expect(reply).toMatchObject({ ok: true, value: { changes: 1 } });
  });

  it("devolve linhas com nome de coluna, nao array", async () => {
    db.exec("CREATE TABLE t (a TEXT, b INTEGER)");
    db.exec("INSERT INTO t VALUES ('x', 2)");
    const reply = await handle(engine, pedido({ op: "all", sql: "SELECT a, b FROM t" }));
    expect(reply).toEqual({ id: 1, ok: true, value: [{ a: "x", b: 2 }] });
  });

  it("first devolve a primeira linha ou nulo", async () => {
    db.exec("CREATE TABLE t (a TEXT)");
    expect(await handle(engine, pedido({ op: "first", sql: "SELECT a FROM t" }))).toEqual({
      id: 1,
      ok: true,
      value: null,
    });
    db.exec("INSERT INTO t VALUES ('x')");
    expect(await handle(engine, pedido({ op: "first", sql: "SELECT a FROM t" }))).toEqual({
      id: 1,
      ok: true,
      value: { a: "x" },
    });
  });

  it("erro de SQL vira resposta, nao excecao", async () => {
    const reply = await handle(engine, pedido({ sql: "SELECT * FROM nao_existe" }));
    expect(reply.ok).toBe(false);
    if (!reply.ok) expect(reply.error).toMatch(/no such table/i);
  });

  it("operacao desconhecida e recusada", async () => {
    const reply = await handle(engine, pedido({ op: "drop" as never }));
    expect(reply).toMatchObject({ ok: false });
  });
});
