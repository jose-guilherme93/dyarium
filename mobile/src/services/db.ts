/**
 * Driver local: abre o SQLite (expo-sqlite), aplica migracoes e liga o
 * repositorio do nucleo a esta conexao.
 *
 * Todo o SQL vive em `@/core/repo`. Este arquivo existe so para o que depende
 * de plataforma: abrir o banco, escolher o modo de transacao, contar bytes e
 * encaminhar os efeitos que moram em servico.
 */

import * as SQLite from 'expo-sqlite';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import {
  registerActivityCancel,
  registerDatabase,
  registerDeviceIdentity,
} from '@/core/port';
import { resetRepositoryState } from '@/core/repo';
import { applyMigrations } from '@/core/schema';

import { deviceIdentity } from './device';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;


export async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  // O SQLite web nao suporta transacao exclusiva; a comum serve para migrar e
  // tambem mantem o banco consistente se algo falhar.
  await applyMigrations(db, (task) =>
    Platform.OS === 'web'
      ? db.withTransactionAsync(task)
      : db.withExclusiveTransactionAsync(async () => task()),
  );
}


export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  return getDb();
}

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = openWithRetry().catch((error) => {
      // Uma falha ao abrir (reload deixando a conexao anterior presa, WAL
      // travado por um instante) NAO pode ficar guardada: sem isto, toda
      // leitura seguinte recebia o mesmo erro e o app abria sem nenhuma nota,
      // mesmo com os dados intactos no arquivo. A proxima chamada tenta de novo.
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

/** Conexao dedicada para leituras de UI (mapa, painel de entidade).
 *
 * Usa busy_timeout baixo (1s): se o pull ou outra escrita estiver segurando a
 * trava do banco, a leitura de UI nao fica esperando segundos. Falha rapido e
 * o painel mostra os dados que ja tem do snapshot enquanto isso.
 */
let dbUiPromise: Promise<SQLite.SQLiteDatabase> | null = null;
function getDbForUI(): Promise<SQLite.SQLiteDatabase> {
  if (!dbUiPromise) {
    dbUiPromise = openDatabaseForUI().catch((error) => {
      dbUiPromise = null;
      throw error;
    });
  }
  return dbUiPromise;
}

async function openDatabaseForUI(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync('dyarium.db');
  try {
    if (Platform.OS !== 'web') {
      await db.execAsync('PRAGMA journal_mode = WAL;').catch(() => undefined);
    }
    // Leitura de UI nao pode esperar 30s pelo lock do pull. Espera no maximo
    // 1s e segue com o que tem.
    await db.execAsync('PRAGMA busy_timeout = 1000;');
    return db;
  } catch (error) {
    await db.closeAsync().catch(() => undefined);
    throw error;
  }
}

const DB_OPEN_ATTEMPTS = 3;

async function openWithRetry(): Promise<SQLite.SQLiteDatabase> {
  let lastError: unknown;
  for (let attempt = 0; attempt < DB_OPEN_ATTEMPTS; attempt += 1) {
    try {
      return await openDatabase();
    } catch (error) {
      lastError = error;
      if (attempt < DB_OPEN_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync('dyarium.db');
  try {
    // O SQLite web (wasm) nao implementa WAL; no aparelho ele e essencial.
    // Melhor-esforco: num reload a conexao anterior pode estar viva por um
    // instante e este PRAGMA pede trava exclusiva. A base ja esta em WAL, entao
    // falhar aqui nao pode impedir o app de abrir e ler as notas.
    if (Platform.OS !== 'web') {
      await db.execAsync('PRAGMA journal_mode = WAL;').catch(() => undefined);
    }
    // Espera a trava liberar em vez de falhar na hora: em desenvolvimento um
    // reload pode deixar a conexao anterior presa por um instante, o que
    // antes virava "database is locked" ao iniciar a gravacao.
    await db.execAsync('PRAGMA busy_timeout = 30000;');
    await migrate(db);
    return db;
  } catch (error) {
    // Nao deixa a conexao aberta segurando o arquivo: a proxima tentativa abriria
    // a mesma base e o WAL continuaria travado.
    await db.closeAsync().catch(() => undefined);
    throw error;
  }
}


/**
 * Apaga o banco local inteiro (notas, cadernos, analises e flags). Usado no
 * "sair da conta" do Drive, depois de o retrato ser sincronizado e conferido.
 *
 * Fecha as duas conexoes antes de remover o arquivo: no Android um descritor
 * aberto mantem o WAL e o `deleteDatabaseAsync` falharia. Os caches de memoria
 * do repositorio sao zerados para a proxima leitura nao devolver dados do
 * arquivo que nao existe mais.
 */
export async function wipeLocalDatabase(): Promise<void> {
  const main = dbPromise;
  const ui = dbUiPromise;
  dbPromise = null;
  dbUiPromise = null;

  for (const pending of [main, ui]) {
    if (!pending) continue;
    try {
      const db = await pending;
      await db.closeAsync();
    } catch {
      // Conexao que nunca abriu ou ja fechada: o arquivo ainda pode ser apagado.
    }
  }

  await SQLite.deleteDatabaseAsync('dyarium.db');
  resetRepositoryState();
}


/**
 * Tamanho do banco local (arquivo principal + WAL/SHM, quando existirem).
 * Cai para as paginas do SQLite se o caminho do arquivo nao for encontrado.
 */
export async function databaseBytes(): Promise<number> {
  try {
    const dir = new Directory(Paths.document, 'SQLite');
    if (dir.exists) {
      let total = 0;
      for (const name of ['dyarium.db', 'dyarium.db-wal', 'dyarium.db-shm']) {
        const file = new File(dir, name);
        if (file.exists) total += file.size;
      }
      if (total > 0) return total;
    }
  } catch {
    // cai para a leitura pelas paginas do SQLite
  }

  const db = await getDb();
  const pageCount = await db.getFirstAsync<{ page_count: number }>('PRAGMA page_count');
  const pageSize = await db.getFirstAsync<{ page_size: number }>('PRAGMA page_size');
  return (pageCount?.page_count ?? 0) * (pageSize?.page_size ?? 0);
}


registerDatabase(getDb, getDbForUI);
registerDeviceIdentity(deviceIdentity);
registerActivityCancel((key, reason) => {
  void import('./activity')
    .then((m) => m.cancelActivity(key, reason))
    .catch(() => undefined);
});

// O repositorio e o nucleo; aqui ele so ganha a conexao deste ambiente.
export * from '@/core/repo';
