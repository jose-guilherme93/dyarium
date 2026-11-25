/**
 * Banco local do navegador: mesma porta `Database` do nucleo, ligada a um
 * Worker que roda wa-sqlite sobre OPFS.
 *
 * A pagina e a unica dona da fila: fora de transacao, tudo e serializado; dentro
 * dela, a chamada passa direto, senao ficaria atras do proprio `BEGIN`.
 */

import {
  registerDatabase,
  registerDeviceIdentity,
  type Database,
} from "../../../mobile/src/core/port";
import { applyMigrations, type RunResult } from "../../../mobile/src/core/schema";

import { ATTACHMENTS_STORE, COVERS_STORE, storeClear } from "../lib/idb";

import type { Op, Request, Reply } from "./protocol";

export interface Transport {
  call(op: Op, sql: string, params?: unknown[]): Promise<unknown>;
}

/** O port espera `params?: unknown`; o protocolo manda sempre array. */
function asParams(params: unknown): unknown[] {
  if (params == null) return [];
  return Array.isArray(params) ? params : [params];
}

export function createDatabase(transport: Transport): Database {
  let depth = 0;
  let queue: Promise<unknown> = Promise.resolve();

  const raw = <T>(op: Op, sql: string, params?: unknown[]): Promise<T> =>
    transport.call(op, sql, params) as Promise<T>;

  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const call = <T>(op: Op, sql: string, params?: unknown[]): Promise<T> =>
    depth > 0 ? raw<T>(op, sql, params) : enqueue(() => raw<T>(op, sql, params));

  const db: Database = {
    execAsync: (sql) => call("exec", sql).then(() => undefined),
    runAsync: (sql, params) => call<RunResult>("run", sql, asParams(params)),
    getAllAsync: <T>(sql: string, params?: unknown) => call<T[]>("all", sql, asParams(params)),
    getFirstAsync: <T>(sql: string, params?: unknown) =>
      call<T | null>("first", sql, asParams(params)),
    withTransactionAsync: (task) =>
      enqueue(async () => {
        await raw("exec", "BEGIN");
        depth += 1;
        try {
          await task();
          await raw("exec", "COMMIT");
        } catch (error) {
          await raw("exec", "ROLLBACK").catch(() => undefined);
          throw error;
        } finally {
          depth -= 1;
        }
      }),
    withExclusiveTransactionAsync: async (task) => {
      await db.withTransactionAsync(() => task(db));
    },
  };

  return db;
}

/** Liga o transporte de mensagens do Worker. */
export function workerTransport(worker: Worker): Transport {
  let next = 0;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  const fail = (error: Error) => {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };

  worker.onmessage = (event: MessageEvent<Reply>) => {
    const reply = event.data;
    const slot = pending.get(reply.id);
    if (!slot) return;
    pending.delete(reply.id);
    if (reply.ok) slot.resolve(reply.value);
    else slot.reject(new Error(reply.error));
  };
  worker.onerror = (event) => fail(new Error(event.message || "worker do banco caiu"));

  return {
    call: (op, sql, params) =>
      new Promise((resolve, reject) => {
        const id = next;
        next += 1;
        pending.set(id, { resolve, reject });
        const request: Request = { id, op, sql, params };
        worker.postMessage(request);
      }),
  };
}

/**
 * Identidade do aparelho no navegador: id aleatorio por perfil, guardado local.
 * Nao e conta nem login; e o nome que carimba versoes neste cofre.
 */
export function webDeviceIdentity(): { id: string; name: string } {
  const chave = "dyarium.device";
  const guardado = localStorage.getItem(chave);
  if (guardado) {
    try {
      const parsed = JSON.parse(guardado) as { id?: string; name?: string };
      if (parsed.id) return { id: parsed.id, name: parsed.name ?? "navegador" };
    } catch {
      // valor corrompido: recria abaixo
    }
  }
  const novo = { id: `dev_${crypto.randomUUID().replace(/-/g, "")}`, name: "navegador" };
  localStorage.setItem(chave, JSON.stringify(novo));
  return novo;
}

/** Worker vivo nesta pagina; o sair da conta precisa fecha-lo antes de apagar. */
let activeWorker: Worker | null = null;

/**
 * Abre o banco do navegador, aplica as migracoes do nucleo e liga as portas.
 * Devolve o mesmo `Database` que o app usa.
 */
export function openWebDatabase(): Promise<Database> {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  activeWorker = worker;
  const db = createDatabase(workerTransport(worker));

  // As portas sao ligadas antes de qualquer `await`: uma consulta disparada no
  // primeiro render espera a abertura em vez de falhar com "banco nao aberto".
  const opening = (async () => {
    await db.execAsync("PRAGMA busy_timeout = 2000");
    await applyMigrations(db, (task) => db.withTransactionAsync(task));
    return db;
  })();

  registerDatabase(() => opening);
  registerDeviceIdentity(async () => webDeviceIdentity());
  return opening;
}

/** Encerra o worker que mantem o SQLite aberto sobre OPFS. */
export function closeWebDatabase(): void {
  activeWorker?.terminate();
  activeWorker = null;
}

export interface OpfsRootLike {
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}

export interface OpfsStorageLike {
  getDirectory(): Promise<OpfsRootLike>;
}

function opfsStorage(): OpfsStorageLike | null {
  const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
  if (!storage || typeof storage.getDirectory !== "function") return null;
  return storage as unknown as OpfsStorageLike;
}

/** Pasta ausente nao e falha; qualquer outro erro do OPFS precisa aparecer. */
function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "NotFoundError"
  );
}

/**
 * Apaga o banco SQLite/OPFS desta conta. O diretorio do VFS e isolado, entao
 * os pesos de modelo guardados pelo motor continuam onde estao.
 *
 * NotFoundError quer dizer que ja nao havia banco; os demais erros sobem para
 * o sair falhar em vez de seguir como se o cache tivesse sumido.
 */
export async function removeWebDatabaseFiles(
  storage: OpfsStorageLike | null = opfsStorage(),
): Promise<void> {
  if (!storage) return;
  let raiz: OpfsRootLike;
  try {
    raiz = await storage.getDirectory();
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }
  try {
    await raiz.removeEntry("dyarium", { recursive: true });
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }
}

/** Anexos e capas da conta vivem no IndexedDB; o banco de modelos e outro. */
export async function clearVaultIndexedDb(): Promise<void> {
  await Promise.all([storeClear(ATTACHMENTS_STORE), storeClear(COVERS_STORE)]);
}

export interface WipeLocalVaultDeps {
  closeDatabase?: () => void | Promise<void>;
  removeDatabaseFiles?: () => Promise<void>;
  clearIndexedDb?: () => Promise<void>;
}

/**
 * Apaga o cache local do cofre da conta. Fecha o banco antes de remover os
 * arquivos para o worker nao recriar o SQLite; os modelos ficam intactos.
 * Testavel por fakes para a ordem e as chamadas serem verificadas sem browser.
 */
export async function wipeLocalVault(deps: WipeLocalVaultDeps = {}): Promise<void> {
  await (deps.closeDatabase ?? closeWebDatabase)();
  await (deps.removeDatabaseFiles ?? removeWebDatabaseFiles)();
  await (deps.clearIndexedDb ?? clearVaultIndexedDb)();
}
