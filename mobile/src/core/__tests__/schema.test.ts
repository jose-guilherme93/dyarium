import { LATEST_SCHEMA_VERSION, MIGRATIONS, migrationsToRun, type SchemaDb } from '../schema';

/** Banco de mentira: guarda o SQL e responde o que a migracao pergunta. */
function recordingDb(): { db: SchemaDb; sql: string[] } {
  const sql: string[] = [];
  const db: SchemaDb = {
    execAsync: async (source) => {
      sql.push(source);
    },
    runAsync: async (source) => {
      sql.push(source);
      return { lastInsertRowId: 0, changes: 0 };
    },
    getFirstAsync: async () => null,
    getAllAsync: async () => [],
  };
  return { db, sql };
}

describe('schema local', () => {
  it('tem versao 1 na frente e so cresce', () => {
    expect(MIGRATIONS.length).toBeGreaterThan(0);
    expect(MIGRATIONS[0].version).toBe(1);
    for (let i = 1; i < MIGRATIONS.length; i += 1) {
      expect(MIGRATIONS[i].version).toBeGreaterThan(MIGRATIONS[i - 1].version);
    }
  });

  it('nao repete versao e todas tem passo', () => {
    const versoes = MIGRATIONS.map((migration) => migration.version);
    expect(new Set(versoes).size).toBe(versoes.length);
    for (const migration of MIGRATIONS) expect(typeof migration.run).toBe('function');
  });

  it('LATEST_SCHEMA_VERSION e a ultima da lista', () => {
    expect(LATEST_SCHEMA_VERSION).toBe(MIGRATIONS[MIGRATIONS.length - 1].version);
  });

  it('entrega so o que falta aplicar, em ordem', () => {
    expect(migrationsToRun(0)).toHaveLength(MIGRATIONS.length);
    expect(migrationsToRun(LATEST_SCHEMA_VERSION)).toHaveLength(0);
    const pendentes = migrationsToRun(LATEST_SCHEMA_VERSION - 1);
    expect(pendentes.map((migration) => migration.version)).toEqual([LATEST_SCHEMA_VERSION]);
    expect(migrationsToRun(3).every((migration) => migration.version > 3)).toBe(true);
  });

  it('aplica a lista inteira sem tocar em plataforma', async () => {
    const { db, sql } = recordingDb();
    for (const migration of migrationsToRun(0)) await migration.run(db);

    const all = sql.join('\n');
    for (const tabela of [
      'recordings',
      'notebooks',
      'analyses',
      'analysis_chunks',
      'entities',
      'entity_outbox',
      'server_instance',
      'entry_sync',
      'notebook_sync',
      'tombstones',
      'transcript_sync_env',
      'analysis_sync_env',
    ]) {
      expect(all).toMatch(new RegExp(`CREATE TABLE (IF NOT EXISTS )?${tabela}\\b`));
    }
  });

  it('nenhuma migracao usa SQL vazio', async () => {
    const { db, sql } = recordingDb();
    for (const migration of migrationsToRun(0)) await migration.run(db);
    expect(sql.length).toBeGreaterThan(0);
    for (const statement of sql) expect(statement.trim().length).toBeGreaterThan(0);
  });
});
