import { DatabaseSync } from 'node:sqlite';

import type * as SQLite from 'expo-sqlite';

import { LATEST_SCHEMA_VERSION } from '@/core/schema';
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
      -- Um banco parado na versao 40 ja tem cadernos (a migracao 3 os cria).
      CREATE TABLE notebooks (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '',
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        dirty INTEGER NOT NULL DEFAULT 0,
        synced INTEGER NOT NULL DEFAULT 1,
        deleted INTEGER NOT NULL DEFAULT 0,
        kind TEXT NOT NULL DEFAULT 'notes'
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
    expect(version.user_version).toBe(LATEST_SCHEMA_VERSION);
    db.close();
  });

  it('banco na v42 ganha as colunas do modo escritor', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE recordings (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL
      );
      CREATE TABLE notebooks (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '',
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        dirty INTEGER NOT NULL DEFAULT 0,
        synced INTEGER NOT NULL DEFAULT 1,
        deleted INTEGER NOT NULL DEFAULT 0,
        kind TEXT NOT NULL DEFAULT 'notes'
      );
    `);
    db.exec("INSERT INTO recordings (id, title) VALUES ('r_cap', 'capitulo')");
    db.exec('PRAGMA user_version = 42');

    await migrate(adapter(db));

    const columns = db.prepare('PRAGMA table_info(recordings)').all() as {
      name: string;
      notnull: number;
      dflt_value: string | null;
    }[];
    const totais: [string, number, string][] = [
      ['chapter_kind', 1, "''"],
      ['chapter_position', 1, '0'],
      ['chapter_status', 1, "''"],
      ['chapter_goal_words', 1, '0'],
      ['chapter_synopsis', 1, "''"],
      ['chapter_beats', 1, "''"],
      ['chapter_notes', 1, "''"],
    ];
    for (const [nome, notnull, padrao] of totais) {
      const coluna = columns.find((column) => column.name === nome);
      expect(coluna).toBeDefined();
      expect(coluna?.notnull).toBe(notnull);
      expect(coluna?.dflt_value).toBe(padrao);
    }

    const rows = db
      .prepare('SELECT chapter_kind, chapter_position, chapter_goal_words FROM recordings')
      .all() as { chapter_kind: string; chapter_position: number; chapter_goal_words: number }[];
    expect(rows).toEqual([{ chapter_kind: '', chapter_position: 0, chapter_goal_words: 0 }]);

    // As tabelas do ritmo e dos links aceitam escrita, como as do servidor.
    db.prepare('INSERT INTO writing_days (notebook_id, day, words) VALUES (?, ?, ?)').run(
      'nb_livro',
      '2026-01-02',
      320,
    );
    db.prepare(
      `INSERT INTO entry_links
        (id, from_entry_id, to_entry_id, url, label, title, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('link_1', 'r_cap', 'r_outro', '', 'capitulo 2', 'Capitulo 2', '2026-01-02T10:00:00Z');

    const dia = db
      .prepare('SELECT notebook_id, day, words FROM writing_days')
      .all() as { notebook_id: string; day: string; words: number }[];
    expect(dia).toEqual([{ notebook_id: 'nb_livro', day: '2026-01-02', words: 320 }]);

    const links = db
      .prepare('SELECT id, from_entry_id, to_entry_id, created_at FROM entry_links')
      .all() as { id: string; from_entry_id: string; to_entry_id: string; created_at: string }[];
    expect(links).toEqual([
      {
        id: 'link_1',
        from_entry_id: 'r_cap',
        to_entry_id: 'r_outro',
        created_at: '2026-01-02T10:00:00Z',
      },
    ]);

    const version = db.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(version.user_version).toBe(LATEST_SCHEMA_VERSION);
    db.close();
  });
});
