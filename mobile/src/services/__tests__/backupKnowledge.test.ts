/**
 * O backup precisa levar o que a nota nao carrega: analises, blocos ja lidos e
 * o estado do mapa. O app e um cliente independente, entao reinstalar e
 * restaurar nao pode depender de sincronizar com o servidor para o mapa voltar.
 *
 * O teste usa o SQL real da migracao num banco em memoria do Node, como
 * `db-migrations.test.ts`: assim o SQL de exportacao/importacao roda de verdade.
 */

import { DatabaseSync } from 'node:sqlite';

import type * as SQLite from 'expo-sqlite';

import type { BackupKnowledge } from '@/core/backup';

import { exportBackupKnowledge, importBackupKnowledge, migrate } from '../db';

function adapter(db: DatabaseSync): SQLite.SQLiteDatabase {
  const get = <T>(sql: string, params: unknown[] = []): T | null =>
    (db.prepare(sql).get(...params) as T | undefined) ?? null;
  return {
    execAsync: async (sql: string) => {
      db.exec(sql);
    },
    runAsync: async (sql: string, params: unknown[] = []) => db.prepare(sql).run(...params),
    getFirstAsync: async <T>(sql: string, params: unknown[] = []) => get<T>(sql, params),
    getAllAsync: async <T>(sql: string, params: unknown[] = []) =>
      db.prepare(sql).all(...params) as T[],
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

interface Fixture {
  raw: DatabaseSync;
  db: SQLite.SQLiteDatabase;
}

async function freshDatabase(): Promise<Fixture> {
  const raw = new DatabaseSync(':memory:');
  await migrate(adapter(raw));
  return { raw, db: adapter(raw) };
}

function seedKnowledge(raw: DatabaseSync): void {
  raw.exec(`
    INSERT INTO analyses
      (entry_id, title, recorded_at, payload, fetched_at, origin, analysis_content_hash)
    VALUES
      ('r1', 'Nota um', '2026-10-11T00:00:00.000Z', '{"summary":"ok"}',
       '2026-10-12T00:00:00.000Z', 'local', 'hash-1');

    INSERT INTO analysis_chunks
      (entry_id, block_index, block_hash, prompt_version, model, status, dropped, payload, updated_at)
    VALUES
      ('r1', 0, 'bloco-0', 3, 'modelo', 'ok', 2, '{"items":[]}', '2026-10-12T00:00:00.000Z');

    INSERT INTO entities (id, kind, name, label, icon, created_at, updated_at)
    VALUES
      ('ent_1', 'person', 'Ana', 'Aninha', 'star',
       '2026-10-11T00:00:00.000Z', '2026-10-12T00:00:00.000Z');

    INSERT INTO entity_aliases (id, entity_id, kind, name, created_at, updated_at)
    VALUES
      ('ali_1', 'ent_1', 'person', 'Aninha',
       '2026-10-11T00:00:00.000Z', '2026-10-12T00:00:00.000Z');

    INSERT INTO entry_entities (entry_id, entity_id, count, relation, sentiment, created_at)
    VALUES ('r1', 'ent_1', 3, 'irma', 0.5, '2026-10-11T00:00:00.000Z');

    INSERT INTO owner_aliases (name, created_at, updated_at)
    VALUES ('Eu', '2026-10-11T00:00:00.000Z', '');

    INSERT INTO entity_rejections (kind, name, name_key, created_at, updated_at)
    VALUES ('person', 'Paulo', 'paulo', '2026-10-11T00:00:00.000Z', '');

    INSERT INTO graph_layout (key, data, updated_at)
    VALUES ('default', '{"nodes":[]}', '2026-10-12T00:00:00.000Z');

    INSERT INTO transcript_sync (entry_id, source_at)
    VALUES ('r1', '2026-10-12T00:00:00.000Z');
    INSERT INTO analysis_sync (entry_id, source_at)
    VALUES ('r1', '2026-10-12T00:00:00.000Z');
    INSERT INTO transcript_sync_env (server_id, entry_id, source_at)
    VALUES ('srv_1', 'r1', '2026-10-12T00:00:00.000Z');
    INSERT INTO analysis_sync_env (server_id, entry_id, source_at)
    VALUES ('srv_1', 'r1', '2026-10-12T00:00:00.000Z');

    INSERT INTO app_flags (key, value)
    VALUES ('author_settings', '{"ownerName":"Ana","allNotesMine":false}');
    INSERT INTO app_flags (key, value)
    VALUES ('graph_snapshot:default', '{"velho":true}');
  `);
}

describe('conhecimento local do backup', () => {
  it('exporta e reimporta analises, blocos e o mapa inteiro', async () => {
    const source = await freshDatabase();
    seedKnowledge(source.raw);

    const knowledge = await exportBackupKnowledge(source.db);
    expect(knowledge.analyses).toEqual([
      {
        entryId: 'r1',
        title: 'Nota um',
        recordedAt: '2026-10-11T00:00:00.000Z',
        payload: '{"summary":"ok"}',
        fetchedAt: '2026-10-12T00:00:00.000Z',
        origin: 'local',
        contentHash: 'hash-1',
      },
    ]);
    expect(knowledge.analysisChunks[0]).toMatchObject({
      entryId: 'r1',
      blockIndex: 0,
      blockHash: 'bloco-0',
      dropped: 2,
    });
    expect(knowledge.entities[0]).toMatchObject({ id: 'ent_1', name: 'Ana', label: 'Aninha' });
    expect(knowledge.entityAliases[0]).toMatchObject({ id: 'ali_1', name: 'Aninha' });
    expect(knowledge.entryEntities[0]).toMatchObject({
      entryId: 'r1',
      entityId: 'ent_1',
      count: 3,
      relation: 'irma',
      sentiment: 0.5,
    });
    expect(knowledge.ownerAliases).toEqual([
      { name: 'Eu', createdAt: '2026-10-11T00:00:00.000Z', updatedAt: '' },
    ]);
    expect(knowledge.entityRejections[0]).toMatchObject({ kind: 'person', nameKey: 'paulo' });
    expect(knowledge.graphLayout).toHaveLength(1);
    expect(knowledge.transcriptSync).toEqual([
      { entryId: 'r1', sourceAt: '2026-10-12T00:00:00.000Z' },
    ]);
    expect(knowledge.analysisSyncEnv).toEqual([
      { serverId: 'srv_1', entryId: 'r1', sourceAt: '2026-10-12T00:00:00.000Z' },
    ]);
    expect(knowledge.author).toEqual({ ownerName: 'Ana', allNotesMine: false });

    // Instalacao nova: restaurar devolve o mapa sem tocar na rede.
    const target = await freshDatabase();
    await importBackupKnowledge(knowledge, target.db);

    expect(
      target.raw.prepare('SELECT entry_id, payload FROM analyses').all(),
    ).toEqual([{ entry_id: 'r1', payload: '{"summary":"ok"}' }]);
    expect(target.raw.prepare('SELECT COUNT(*) AS n FROM analysis_chunks').get()).toEqual({ n: 1 });
    expect(
      target.raw.prepare('SELECT id, name, label, icon FROM entities').all(),
    ).toEqual([{ id: 'ent_1', name: 'Ana', label: 'Aninha', icon: 'star' }]);
    expect(
      target.raw
        .prepare('SELECT entry_id, entity_id, count, relation, sentiment FROM entry_entities')
        .all(),
    ).toEqual([
      { entry_id: 'r1', entity_id: 'ent_1', count: 3, relation: 'irma', sentiment: 0.5 },
    ]);
    expect(target.raw.prepare('SELECT name FROM owner_aliases').all()).toEqual([{ name: 'Eu' }]);
    expect(target.raw.prepare('SELECT name FROM entity_rejections').all()).toEqual([
      { name: 'Paulo' },
    ]);
    expect(target.raw.prepare('SELECT key FROM graph_layout').all()).toEqual([{ key: 'default' }]);
    // Marcadores de "ja trocado": sem eles o primeiro sync rebaixaria tudo.
    expect(
      target.raw.prepare('SELECT entry_id, source_at FROM transcript_sync').all(),
    ).toEqual([{ entry_id: 'r1', source_at: '2026-10-12T00:00:00.000Z' }]);
    expect(
      target.raw
        .prepare('SELECT server_id, entry_id FROM analysis_sync_env')
        .all(),
    ).toEqual([{ server_id: 'srv_1', entry_id: 'r1' }]);
    // O dono volta junto: sem isso, a analise seguinte criaria ele como pessoa.
    expect(
      target.raw.prepare("SELECT value FROM app_flags WHERE key = 'author_settings'").get(),
    ).toEqual({ value: '{"ownerName":"Ana","allNotesMine":false}' });
  });

  it('nao sobrescreve analise mais nova ja feita no aparelho', async () => {
    const source = await freshDatabase();
    seedKnowledge(source.raw);
    const knowledge = await exportBackupKnowledge(source.db);

    const target = await freshDatabase();
    target.raw.exec(`
      INSERT INTO analyses (entry_id, title, recorded_at, payload, fetched_at, origin)
      VALUES ('r1', 'Nota nova', '2026-10-20T00:00:00.000Z', '{"summary":"novo"}',
              '2026-10-20T00:00:00.000Z', 'local');
    `);

    await importBackupKnowledge(knowledge, target.db);

    expect(target.raw.prepare('SELECT payload FROM analyses').all()).toEqual([
      { payload: '{"summary":"novo"}' },
    ]);
  });

  it('derruba o recorte antigo do mapa e dispensa o backfill', async () => {
    const source = await freshDatabase();
    seedKnowledge(source.raw);
    const target = await freshDatabase();
    await importBackupKnowledge(await exportBackupKnowledge(source.db), target.db);

    expect(
      target.raw.prepare("SELECT COUNT(*) AS n FROM app_flags WHERE key LIKE 'graph_snapshot:%'").get(),
    ).toEqual({ n: 0 });
    expect(
      target.raw
        .prepare("SELECT value FROM app_flags WHERE key = 'entities_backfilled_v1'")
        .get(),
    ).toEqual({ value: 'true' });
  });

  it('restaurar duas vezes nao duplica nada', async () => {
    const source = await freshDatabase();
    seedKnowledge(source.raw);
    const knowledge: BackupKnowledge = await exportBackupKnowledge(source.db);

    const target = await freshDatabase();
    await importBackupKnowledge(knowledge, target.db);
    await importBackupKnowledge(knowledge, target.db);

    expect(target.raw.prepare('SELECT COUNT(*) AS n FROM analyses').get()).toEqual({ n: 1 });
    expect(target.raw.prepare('SELECT COUNT(*) AS n FROM entry_entities').get()).toEqual({ n: 1 });
    expect(target.raw.prepare('SELECT COUNT(*) AS n FROM entities').get()).toEqual({ n: 1 });
  });
});
