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
import { comReserva, SQLITE_IDB_NAME } from "./vfs";

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

/** Banco sobre OPFS: o caminho rapido, padrao. */
async function openOpfsApi(): Promise<Api> {
  const module = await factory({ locateFile: () => wasmUrl });
  const api: Api = SQLite.Factory(module);
  const vfs = new AccessHandlePoolVFS("/dyarium");
  await vfs.isReady;
  // O tipo publicado do VFS e a interface completa; o exemplo entrega o
  // objeto com os mesmos ganchos, so sem a declaracao.
  api.vfs_register(vfs as unknown as Parameters<Api["vfs_register"]>[0], true);
  return api;
}

/** Banco sobre IndexedDB: usado quando o navegador recusa o OPFS. */
async function openIndexedDbApi(): Promise<Api> {
  const module = await factoryAsync({ locateFile: () => wasmAsyncUrl });
  const api: Api = SQLite.Factory(module);
  // Nome proprio: o IndexedDB do SQLite nao pode ser o mesmo `dyarium` que o
  // cache do app usa, senao o open estoura VersionError.
  const vfs = new IDBBatchAtomicVFS(SQLITE_IDB_NAME);
  api.vfs_register(vfs as unknown as Parameters<Api["vfs_register"]>[0], true);
  return api;
}

function montarEngine(api: Api, db: number): Engine {
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

async function openEngine(): Promise<Engine> {
  // `VITE_DB_FORCE_IDB=1` forca o caminho de IndexedDB para testar o fallback
  // num navegador que tem OPFS. Em producao a variavel nao existe.
  const forcarIdb = import.meta.env.VITE_DB_FORCE_IDB === "1";
  // A reserva cobre tanto a criacao do VFS quanto o open: um OPFS que existe
  // mas recusa a abertura tambem cai no IndexedDB.
  const { api, db } = await comReserva(
    async () => {
      if (forcarIdb) throw new Error("fallback de IndexedDB forcado");
      const opfs = await openOpfsApi();
      return { api: opfs, db: await opfs.open_v2("dyarium.db") };
    },
    async () => {
      const idb = await openIndexedDbApi();
      return { api: idb, db: await idb.open_v2("dyarium.db") };
    },
  );
  return montarEngine(api, db);
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
