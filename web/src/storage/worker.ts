/**
 * Worker do banco: o unico lugar que fala com o SQLite no navegador.
 *
 * wa-sqlite sobre OPFS (AccessHandlePoolVFS). O acesso sincrono ao arquivo so
 * existe em Worker, e um escritor so elimina a corrida entre abas.
 */

/// <reference lib="webworker" />

import * as SQLite from "wa-sqlite";
import factory from "wa-sqlite/dist/wa-sqlite.mjs";
import factoryAsync from "wa-sqlite/dist/wa-sqlite-async.mjs";
import { AccessHandlePoolVFS } from "wa-sqlite/src/examples/AccessHandlePoolVFS.js";
import { IDBBatchAtomicVFS } from "wa-sqlite/src/examples/IDBBatchAtomicVFS.js";

import wasmUrl from "wa-sqlite/dist/wa-sqlite.wasm?url";
import wasmAsyncUrl from "wa-sqlite/dist/wa-sqlite-async.wasm?url";

import { handle, type Engine, type Reply, type Request } from "./protocol";

type Api = ReturnType<typeof SQLite.Factory>;

/** Primeira coluna de uma consulta de uma linha so. */
async function scalar(api: Api, db: number, sql: string): Promise<number> {
  for await (const stmt of api.statements(db, sql)) {
    if ((await api.step(stmt)) === SQLite.SQLITE_ROW) {
      const value = api.row(stmt)[0];
      return typeof value === "number" ? value : Number(value ?? 0);
    }
  }
  return 0;
}

/** Banco sobre IndexedDB: usado quando o navegador recusa o OPFS. */
async function openIndexedDbApi(): Promise<Api> {
  const module = await factoryAsync({ locateFile: () => wasmAsyncUrl });
  const api: Api = SQLite.Factory(module);
  const vfs = new IDBBatchAtomicVFS("dyarium");
  api.vfs_register(vfs as unknown as Parameters<Api["vfs_register"]>[0], true);
  return api;
}

async function openEngine(): Promise<Engine> {
  let api: Api;
  // `VITE_DB_FORCE_IDB=1` forca o caminho de IndexedDB para testar o fallback
  // num navegador que tem OPFS. Em producao a variavel nao existe.
  const forcarIdb = import.meta.env.VITE_DB_FORCE_IDB === "1";
  try {
    if (forcarIdb) throw new Error("fallback de IndexedDB forcado");
    const module = await factory({ locateFile: () => wasmUrl });
    api = SQLite.Factory(module);
    const vfs = new AccessHandlePoolVFS("/dyarium");
    await vfs.isReady;
    // O tipo publicado do VFS e a interface completa; o exemplo entrega o
    // objeto com os mesmos ganchos, so sem a declaracao.
    api.vfs_register(vfs as unknown as Parameters<Api["vfs_register"]>[0], true);
  } catch {
    // OPFS indisponivel (privado, politica do navegador, handle recusado): o
    // IndexedDB guarda o mesmo banco de forma persistente e segue o app.
    api = await openIndexedDbApi();
  }

  const db = await api.open_v2("dyarium.db");

  return {
    exec: async (sql) => {
      await api.exec(db, sql);
    },
    run: async (sql, params) => {
      let changes = 0;
      for await (const stmt of api.statements(db, sql)) {
        api.bind_collection(stmt, params as never);
        await api.step(stmt);
        changes = api.changes(db);
      }
      // wa-sqlite nao publica o gancho de last_insert_rowid; a consulta devolve
      // o mesmo valor que o driver nativo entregaria.
      const lastInsertRowId = await scalar(api, db, "SELECT last_insert_rowid()");
      return { changes, lastInsertRowId };
    },
    all: async <T>(sql: string, params: unknown[]): Promise<T[]> => {
      for await (const stmt of api.statements(db, sql)) {
        api.bind_collection(stmt, params as never);
        const columns = api.column_names(stmt);
        const rows: T[] = [];
        while ((await api.step(stmt)) === SQLite.SQLITE_ROW) {
          const values = api.row(stmt);
          rows.push(
            Object.fromEntries(columns.map((name, index) => [name, values[index]])) as unknown as T,
          );
        }
        return rows;
      }
      return [];
    },
  };
}

const ready = openEngine();

self.onmessage = async (event: MessageEvent<Request>) => {
  let reply: Reply;
  try {
    reply = await handle(await ready, event.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reply = { id: event.data.id, ok: false, error: `banco nao abriu: ${message}` };
  }
  self.postMessage(reply);
};
