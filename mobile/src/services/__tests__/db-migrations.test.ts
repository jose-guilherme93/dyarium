import { DatabaseSync } from 'node:sqlite';

import type * as SQLite from 'expo-sqlite';

import { migrate } from '../db';

/**
 * Adaptador minimo entre o banco em memoria do Node e a API do expo-sqlite
 * usada pelas migracoes. Assim o teste aplica o SQL real, nao uma simulacao.
 */
function adapter(db: DatabaseSync): SQLite.SQLiteDatabase {
  const run = <T>(sql: string, params: unknown[] = []): T => {
    const statement = db.prepare(sql);
    return statement.get(...params) as T;
  };
  return {
    execAsync: async (sql: string) => {
      db.exec(sql);
    },
    runAsync: async (sql: string, params: unknown[] = []) => db.prepare(sql).run(...params),
    getFirstAsync: async <T>(sql: string, params: unknown[] = []) => {
      const row = run<T | undefined>(sql, params);
      return row ?? null;
    },
    getAllAsync: async <T>(sql: string, params: unknown[] = []) => {
      const statement = db.prepare(sql);
      return statement.all(...params) as T[];
    },
    withTransactionAsync: async (task: () => Promise<void>) => {
      db.exec('BEGIN');
      try {
        await task();
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    withExclusiveTransactionAsync: async (task: (txn: SQLite.SQLiteDatabase) => Promise<void>) => {
      db.exec('BEGIN');
      try {
        await task(adapter(db));
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as SQLite.SQLiteDatabase;
}

describe('migracoes locais', () => {
  it('banco anterior a coluna icon ganha o campo vazio sem perder linhas', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE recordings (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL
      );
    `);
    db.exec("INSERT INTO recordings (id, title) VALUES ('r_antiga', 'nota antiga')");
    db.exec('PRAGMA user_version = 40');

    await migrate(adapter(db));

    const columns = db.prepare('PRAGMA table_info(recordings)').all() as {
      name: string;
      notnull: number;
      dflt_value: string | null;
    }[];
    const icon = columns.find((column) => column.name === 'icon');
    expect(icon).toBeDefined();
    expect(icon?.notnull).toBe(1);
    expect(icon?.dflt_value).toBe("''");

    const rows = db
      .prepare("SELECT id, title, icon FROM recordings WHERE id = 'r_antiga'")
      .all() as { id: string; title: string; icon: string }[];
    expect(rows).toEqual([{ id: 'r_antiga', title: 'nota antiga', icon: '' }]);

    const version = db.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(version.user_version).toBe(41);
    db.close();
  });
});
