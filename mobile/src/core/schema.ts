/**
 * Schema local e migracoes versionadas (PRAGMA user_version).
 *
 * Nucleo puro: nao importa expo-sqlite, React Native nem nada de plataforma. O
 * driver entra por `SchemaDb`, entao o app, o navegador e o desktop aplicam
 * exatamente o mesmo SQL.
 *
 * Append-only: nunca edite uma migracao ja publicada; adicione uma nova. A
 * ordem da lista e a ordem de aplicacao e a versao so cresce.
 */

/** Resultado de uma escrita, como o driver devolve. */
export interface RunResult {
  lastInsertRowId: number;
  changes: number;
}

/** O que uma migracao precisa do banco. Implementado por expo-sqlite, wa-sqlite
 * e pelo adaptador de teste (node:sqlite).
 *
 * `params` e `unknown` de proposito: cada driver liga os valores do seu jeito
 * (array, variadico, objeto) e o core nao escolhe por eles. */
export interface SchemaDb {
  execAsync(source: string): Promise<unknown>;
  runAsync(source: string, params?: unknown): Promise<RunResult>;
  getFirstAsync<T>(source: string, params?: unknown): Promise<T | null>;
  getAllAsync<T>(source: string, params?: unknown): Promise<T[]>;
}

export interface Migration {
  version: number;
  run: (db: SchemaDb) => Promise<void>;
}

async function columnExists(db: SchemaDb, table: string, column: string): Promise<boolean> {
  const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return rows.some((row) => row.name === column);
}

async function addColumn(db: SchemaDb, table: string, column: string): Promise<void> {
  if (await columnExists(db, table, column)) return;
  await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
}

// Migracoes versionadas (PRAGMA user_version). Append-only: nunca edite uma
// migracao ja publicada; adicione uma nova.
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    run: async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS recordings (
          id TEXT PRIMARY KEY NOT NULL,
          title TEXT NOT NULL,
          recorded_at TEXT NOT NULL,
          dir TEXT NOT NULL,
          file_path TEXT,
          segment_count INTEGER NOT NULL DEFAULT 0,
          duration_ms INTEGER,
          size_bytes INTEGER,
          status TEXT NOT NULL,
          upload_id TEXT,
          offset INTEGER NOT NULL DEFAULT 0,
          attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at TEXT,
          last_error TEXT,
          entry_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_recordings_status ON recordings(status);
      `);
    },
  },
  {
    version: 2,
    run: async (db) => {
      for (const column of ['transcript', 'transcript_language', 'transcript_status']) {
        await addColumn(db, 'recordings', column);
      }
    },
  },
  {
    version: 3,
    run: async (db) => {
      for (const column of ['source', 'text', 'content_type', 'file_name', 'duplicate', 'archived']) {
        await addColumn(db, 'recordings', column);
      }
    },
  },
  {
    version: 4,
    run: async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS locks (
          name TEXT PRIMARY KEY NOT NULL,
          holder TEXT NOT NULL,
          acquired_at INTEGER NOT NULL
        );
      `);
    },
  },
  {
    version: 5,
    run: async (db) => {
      // Id da nota (corpo rico) no servidor: permite atualizar em vez de recriar.
      await addColumn(db, 'recordings', 'note_id');
    },
  },
  {
    version: 6,
    run: async (db) => {
      // Segmentos da transcricao em cache local (evita refazer fetch ao abrir).
      await addColumn(db, 'recordings', 'transcript_segments');
    },
  },
  {
    version: 7,
    run: async (db) => {
      // Falha permanente (4xx): nao retenta sozinha, so com reenvio manual.
      await addColumn(db, 'recordings', 'terminal');
    },
  },
  {
    version: 8,
    run: async (db) => {
      // Edicao local pendente numa nota ja enviada e mapa de anexos ja subidos
      // (o mapa evita reenviar a mesma imagem a cada edicao da nota).
      await addColumn(db, 'recordings', 'note_dirty');
      await addColumn(db, 'recordings', 'attachments');
    },
  },
  {
    version: 9,
    run: async (db) => {
      // Transcricao: flag "ha transcricao" e a origem (local no aparelho ou
      // recebida do servidor). Quem transcreve primeiro informa o outro.
      await addColumn(db, 'recordings', 'has_transcript');
      await addColumn(db, 'recordings', 'transcript_origin');
    },
  },
  {
    version: 10,
    run: async (db) => {
      // Ultimo snapshot das metricas de escrita: fica sempre pronto no aparelho
      // (o painel le daqui) e sincroniza com o servidor quando existe.
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS metrics_snapshot (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          payload TEXT NOT NULL,
          generated_at TEXT NOT NULL,
          synced_at TEXT
        );
      `);
    },
  },
  {
    version: 11,
    run: async (db) => {
      // Versao lida de cada campo da nota no servidor. Sem isso o app so sabe
      // escrever por cima; com isso, o servidor avisa quando o texto mudou no
      // desktop e o usuario escolhe em vez de perder trabalho.
      await addColumn(db, 'recordings', 'title_version');
      await addColumn(db, 'recordings', 'recorded_at_version');
      await addColumn(db, 'recordings', 'body_version');
      // Campos que o servidor recusou (409), esperando a escolha do usuario.
      await addColumn(db, 'recordings', 'sync_conflict');
    },
  },
  {
    version: 12,
    run: async (db) => {
      // Analises (insights) ja feitas no servidor: guardadas no aparelho para o
      // painel mostrar sem refazer a analise e sem depender da rede.
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS analyses (
          entry_id TEXT PRIMARY KEY,
          title TEXT NOT NULL DEFAULT '',
          recorded_at TEXT NOT NULL DEFAULT '',
          payload TEXT NOT NULL,
          fetched_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 13,
    run: async (db) => {
      // Pilha de audios do servidor (JSON): abrir a nota mostra a ultima copia
      // enquanto a rede revalida em segundo plano, em vez de comecar vazia.
      await addColumn(db, 'recordings', 'server_audios');
    },
  },
  {
    version: 14,
    run: async (db) => {
      // Ate onde a transcricao local chegou (ms). Permite retomar de onde parou
      // depois de fechar o app, em vez de recomecar do zero.
      await addColumn(db, 'recordings', 'transcript_checkpoint_ms');
    },
  },
  {
    version: 15,
    run: async (db) => {
      // Id do audio no servidor. A transcricao local precisa dele para ser
      // exibida junto do audio certo no dashboard.
      await addColumn(db, 'recordings', 'server_attachment_id');
    },
  },
  {
    version: 16,
    run: async (db) => {
      // Analise feita no aparelho vence a do servidor (first-wins): a origem
      // evita que a leitura de fundo sobrescreva o resultado local.
      await addColumn(db, 'analyses', 'origin');
    },
  },
  {
    version: 17,
    run: async (db) => {
      // Hash do conteudo analisado: a ficha sabe quando a analise guardada e
      // de uma versao anterior da nota.
      await addColumn(db, 'analyses', 'analysis_content_hash');
    },
  },
  {
    version: 18,
    run: async (db) => {
      // Uma linha por tentativa de analise local. Diagnostico apenas: medidas e
      // resultado, nunca o texto da nota. Append-only.
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS analysis_runs (
          id TEXT PRIMARY KEY NOT NULL,
          entry_id TEXT NOT NULL,
          analysis_id TEXT,
          attachment_id TEXT,
          runtime TEXT NOT NULL,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          attempt INTEGER NOT NULL DEFAULT 1,
          outcome TEXT NOT NULL,
          error_class TEXT,
          started_at TEXT NOT NULL,
          finished_at TEXT NOT NULL,
          duration_ms INTEGER NOT NULL DEFAULT 0,
          input_text_chars INTEGER NOT NULL DEFAULT 0,
          input_transcript_chars INTEGER NOT NULL DEFAULT 0,
          input_images INTEGER NOT NULL DEFAULT 0,
          prompt_tokens INTEGER NOT NULL DEFAULT 0,
          completion_tokens INTEGER NOT NULL DEFAULT 0,
          tokens_per_second REAL NOT NULL DEFAULT 0,
          threads INTEGER,
          battery_delta_pct REAL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_analysis_runs_started ON analysis_runs(started_at);
        CREATE INDEX IF NOT EXISTS idx_analysis_runs_model ON analysis_runs(runtime, provider, model);
      `);
    },
  },
  {
    version: 19,
    run: async (db) => {
      // Cadernos locais: espelho do servidor + linhas criadas/alteradas offline
      // (`dirty`/`synced`) e tombstones (`deleted`) ate o push confirmar.
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS notebooks (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          color TEXT NOT NULL DEFAULT '',
          is_default INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          dirty INTEGER NOT NULL DEFAULT 0,
          synced INTEGER NOT NULL DEFAULT 1,
          deleted INTEGER NOT NULL DEFAULT 0
        );
      `);
      const stamp = new Date().toISOString();
      await db.runAsync(
        `INSERT OR IGNORE INTO notebooks
          (id, name, color, is_default, created_at, updated_at, dirty, synced, deleted)
         VALUES (?, ?, '', 1, ?, ?, 0, 1, 0)`,
        ['notas-ao-acaso', 'Notas ao acaso', stamp, stamp],
      );
      if (!(await columnExists(db, 'recordings', 'notebook_id'))) {
        await db.execAsync(
          "ALTER TABLE recordings ADD COLUMN notebook_id TEXT NOT NULL DEFAULT 'notas-ao-acaso'",
        );
      }
      await addColumn(db, 'recordings', 'tags');
      await addColumn(db, 'recordings', 'notebook_dirty');
      await addColumn(db, 'recordings', 'tags_dirty');
    },
  },
  {
    version: 20,
    run: async (db) => {
      // Arquivamento pendente. Sem este flag, o sync mandava `archived: false`
      // em toda gravacao e desfazia um arquivamento feito no dashboard antes do
      // pull; o pull tambem podia reverter o que o usuario acabou de arquivar.
      await addColumn(db, 'recordings', 'archived_dirty');
    },
  },
  {
    version: 21,
    run: async (db) => {
      // Revisao da transcricao por IA: modelo, versao do prompt, modo literal e
      // a estimativa de compreensao. Os textos por trecho vivem no JSON de
      // transcript_segments (`revised`), ao lado do original do whisper.
      await addColumn(db, 'recordings', 'transcript_review');
    },
  },
  {
    version: 22,
    run: async (db) => {
      // Historico do centro de atividade. Antes ele vivia so em memoria e
      // sumia a cada abertura; o usuario perdia o que terminou, falhou ou foi
      // interrompido. As acoes (parar, tentar de novo) continuam em memoria:
      // so o registro do que aconteceu e persistente.
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS activity_log (
          id TEXT PRIMARY KEY NOT NULL,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          detail TEXT,
          status TEXT NOT NULL,
          progress INTEGER,
          started_at INTEGER NOT NULL,
          finished_at INTEGER,
          seen INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_activity_log_started
          ON activity_log (started_at DESC);
      `);
    },
  },
  {
    version: 23,
    run: async (db) => {
      // Avisos que o usuario ocultou. Ficam no banco de proposito: o backup
      // exporta as notas (nao o banco), entao reinstalar o app — mesmo
      // restaurando backup — faz o aviso de primeira vez aparecer de novo.
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS app_flags (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 24,
    run: async (db) => {
      // Nota criada a partir de um trecho de transcricao: referencia local
      // (nota de origem + instante) para voltar ao ponto exato. Nao sincroniza.
      if (!(await columnExists(db, 'recordings', 'capture_source_id'))) {
        await db.execAsync('ALTER TABLE recordings ADD COLUMN capture_source_id TEXT');
      }
      if (!(await columnExists(db, 'recordings', 'capture_start_ms'))) {
        await db.execAsync('ALTER TABLE recordings ADD COLUMN capture_start_ms INTEGER');
      }
    },
  },
  {
    version: 25,
    run: async (db) => {
      // Apagar e logico: a nota fica na lixeira por 7 dias, com os arquivos
      // locais, para poder voltar. O mesmo instante vira a data de expiracao.
      if (!(await columnExists(db, 'recordings', 'deleted_at'))) {
        await db.execAsync('ALTER TABLE recordings ADD COLUMN deleted_at TEXT');
      }
      await db.execAsync(
        'CREATE INDEX IF NOT EXISTS idx_recordings_deleted_at ON recordings(deleted_at)',
      );
    },
  },
  {
    version: 26,
    run: async (db) => {
      // Quem gravou a nota. Vazio segue o padrao da instancia (all_notes_mine).
      // O app precisa da escolha offline para a analise local e para o upload.
      if (!(await columnExists(db, 'recordings', 'author'))) {
        await db.execAsync("ALTER TABLE recordings ADD COLUMN author TEXT NOT NULL DEFAULT ''");
      }
      if (!(await columnExists(db, 'recordings', 'author_dirty'))) {
        await db.execAsync('ALTER TABLE recordings ADD COLUMN author_dirty TEXT');
      }
    },
  },
  {
    version: 27,
    run: async (db) => {
      // Analise por bloco: cada paragrafo (ou frase entre pausas) e lido em uma
      // chamada curta e o resultado fica guardado. Refazer a analise so le os
      // blocos que mudaram, e uma passada interrompida continua de onde parou.
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS analysis_chunks (
          entry_id TEXT NOT NULL,
          block_index INTEGER NOT NULL,
          block_hash TEXT NOT NULL,
          prompt_version INTEGER NOT NULL DEFAULT 0,
          model TEXT NOT NULL,
          status TEXT NOT NULL,
          dropped INTEGER NOT NULL DEFAULT 0,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (entry_id, block_index)
        );
        CREATE INDEX IF NOT EXISTS idx_analysis_chunks_entry ON analysis_chunks(entry_id);
      `);
    },
  },
  {
    version: 28,
    run: async (db) => {
      // Sinal de atualizacao da analise vinda do servidor: guarda o
      // `analysis_at` que ja foi buscado. Sem isso, a ficha pediria a analise
      // de novo a cada abertura so para exibir; com ele, busca uma vez por
      // atualizacao e mostra sempre a copia do banco.
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS analysis_sync (
          entry_id TEXT PRIMARY KEY NOT NULL,
          source_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 29,
    run: async (db) => {
      // O mesmo sinal para a transcricao: uma revisao feita no dashboard tem
      // hora propria e o aparelho so busca quando ela muda.
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS transcript_sync (
          entry_id TEXT PRIMARY KEY NOT NULL,
          source_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 30,
    run: async (db) => {
      // O mapa do aparelho e derivado localmente, mas guarda as mesmas tabelas
      // normalizadas do servidor: renomear, mesclar, trocar icone e "sou eu"
      // precisam valer dos dois lados. `entry_entities` usa a mesma chave da
      // analise local (id da gravacao antes do upload, entry id depois).
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS entities (
          id TEXT PRIMARY KEY NOT NULL,
          kind TEXT NOT NULL,
          name TEXT NOT NULL,
          icon TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT '',
          UNIQUE (kind, name)
        );
        CREATE INDEX IF NOT EXISTS idx_entities_kind_name ON entities (kind, name);

        CREATE TABLE IF NOT EXISTS entity_aliases (
          id TEXT PRIMARY KEY NOT NULL,
          entity_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          name TEXT NOT NULL COLLATE NOCASE,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT '',
          UNIQUE (kind, name)
        );
        CREATE INDEX IF NOT EXISTS idx_entity_aliases_entity_id ON entity_aliases (entity_id);

        CREATE TABLE IF NOT EXISTS entry_entities (
          entry_id TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          count INTEGER NOT NULL DEFAULT 1,
          relation TEXT,
          sentiment REAL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (entry_id, entity_id)
        );
        CREATE INDEX IF NOT EXISTS idx_entry_entities_entity ON entry_entities (entity_id);

        CREATE TABLE IF NOT EXISTS owner_aliases (
          name TEXT NOT NULL COLLATE NOCASE PRIMARY KEY,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS graph_layout (
          key TEXT PRIMARY KEY NOT NULL,
          data TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS entity_outbox (
          id TEXT PRIMARY KEY NOT NULL,
          operation TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          name TEXT NOT NULL,
          next_name TEXT,
          icon TEXT,
          created_at TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_entity_outbox_created ON entity_outbox (created_at);
      `);
    },
  },
  {
    version: 31,
    run: async (db) => {
      // Cada ambiente (aparelho ou servidor) e um par independente. O acervo
      // local continua sendo um so; o que multiplica e o estado de sync por
      // ambiente: id remoto, versoes, offset de upload e o ultimo estado
      // confirmado. Sem estas tabelas, `entry_id` unico nao representa "existe
      // no servidor A, falta no servidor B".
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS server_instance (
          id TEXT PRIMARY KEY NOT NULL,
          base_url TEXT NOT NULL,
          label TEXT,
          contract TEXT NOT NULL,
          created_at TEXT NOT NULL,
          last_sync_at TEXT
        );

        CREATE TABLE IF NOT EXISTS entry_sync (
          server_id TEXT NOT NULL,
          recording_id TEXT NOT NULL,
          remote_entry_id TEXT,
          note_id TEXT,
          title_version TEXT,
          recorded_at_version TEXT,
          body_version TEXT,
          upload_id TEXT,
          upload_offset INTEGER NOT NULL DEFAULT 0,
          attachment_refs TEXT,
          primary_attachment_id TEXT,
          synced_title TEXT,
          synced_recorded_at TEXT,
          synced_body_hash TEXT,
          synced_notebook_id TEXT,
          synced_tags TEXT,
          synced_archived INTEGER,
          synced_author TEXT,
          synced_at TEXT,
          last_error TEXT,
          deleted_at TEXT,
          tombstone_pushed_at TEXT,
          PRIMARY KEY (server_id, recording_id)
        );
        CREATE INDEX IF NOT EXISTS idx_entry_sync_recording ON entry_sync (recording_id);

        CREATE TABLE IF NOT EXISTS notebook_sync (
          server_id TEXT NOT NULL,
          notebook_id TEXT NOT NULL,
          synced_name TEXT,
          synced_color TEXT,
          synced_at TEXT,
          PRIMARY KEY (server_id, notebook_id)
        );

        CREATE TABLE IF NOT EXISTS tombstones (
          id TEXT PRIMARY KEY NOT NULL,
          kind TEXT NOT NULL,
          deleted_at TEXT NOT NULL,
          origin TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tombstones_deleted_at ON tombstones (deleted_at, id);

        CREATE TABLE IF NOT EXISTS transcript_sync_env (
          server_id TEXT NOT NULL,
          entry_id TEXT NOT NULL,
          source_at TEXT NOT NULL,
          PRIMARY KEY (server_id, entry_id)
        );

        CREATE TABLE IF NOT EXISTS analysis_sync_env (
          server_id TEXT NOT NULL,
          entry_id TEXT NOT NULL,
          source_at TEXT NOT NULL,
          PRIMARY KEY (server_id, entry_id)
        );

        -- A lixeira local ja era a intencao de exclusao; o tombstone passa a
        -- sobreviver a purga do conteudo.
        INSERT OR IGNORE INTO tombstones (id, kind, deleted_at, origin)
        SELECT id, 'entry', deleted_at, 'local'
        FROM recordings
        WHERE deleted_at IS NOT NULL AND deleted_at <> '';
      `);
    },
  },
  {
    version: 32,
    run: async (db) => {
      // Caderno tambem tem tombstone: sem isso, apagar num ambiente e ele
      // reaparecer vindo do outro. A tabela por ambiente guarda quando a
      // exclusao ja foi entregue.
      await addColumn(db, 'notebook_sync', 'deleted_at');
      await addColumn(db, 'notebook_sync', 'tombstone_pushed_at');
    },
  },
  {
    version: 33,
    run: async (db) => {
      // O contrato nao tem dialogo de conflito: a ultima gravacao vence e o
      // servidor guarda a perdedora no historico. Notas que ficaram presas num
      // conflito antigo voltam para a fila e serao resolvidas pelo push forcado.
      await db.execAsync(`
        UPDATE recordings
        SET note_dirty = 1, sync_conflict = NULL
        WHERE sync_conflict IS NOT NULL;
      `);
    },
  },
  {
    version: 34,
    run: async (db) => {
      // Alinha o tombstone local ao servidor: a identidade e (id, kind). Um id
      // de caderno e um de nota nao podem se anular so porque coincidem.
      await db.execAsync(`
        ALTER TABLE tombstones RENAME TO tombstones_v33;
        CREATE TABLE tombstones (
          id TEXT NOT NULL,
          kind TEXT NOT NULL,
          deleted_at TEXT NOT NULL,
          origin TEXT NOT NULL,
          PRIMARY KEY (id, kind)
        );
        CREATE INDEX IF NOT EXISTS idx_tombstones_deleted_at ON tombstones (deleted_at, id);
        INSERT OR IGNORE INTO tombstones (id, kind, deleted_at, origin)
        SELECT id, kind, deleted_at, origin FROM tombstones_v33;
        DROP TABLE tombstones_v33;
      `);
    },
  },
  {
    version: 35,
    run: async (db) => {
      // Versao da nota no relogio hibrido: o instante da ultima mudanca de
      // conteudo, emitido por quem editou. E o que permite decidir, sem
      // dialogo e sem confiar no relogio do aparelho, qual edicao e a mais nova.
      if (!(await columnExists(db, 'recordings', 'updated_hlc'))) {
        await db.execAsync('ALTER TABLE recordings ADD COLUMN updated_hlc TEXT');
      }
    },
  },
  {
    version: 36,
    run: async (db) => {
      // Modo escritor: o app nao mostra livros, mas guarda o tipo para esconder
      // o caderno e as notas dele da biblioteca e das metricas.
      if (!(await columnExists(db, 'notebooks', 'kind'))) {
        await db.execAsync("ALTER TABLE notebooks ADD COLUMN kind TEXT NOT NULL DEFAULT 'notes'");
      }
    },
  },
  {
    version: 37,
    run: async (db) => {
      // Limpa o "Transcrevendo 0%" eterno que versoes anteriores deixaram nas
      // notas puxadas do servidor: elas nascam com `transcript_status =
      // 'pending'` e o app pedia /transcript a cada 8 s para sempre quando o
      // servidor nao transcrevia. A partir daqui quem avisa que o texto ficou
      // pronto e o `transcript_at` da entrada (syncServerTranscripts), entao um
      // pending sem texto e sem posse local e lixo de estado.
      await db.execAsync(`
        UPDATE recordings
           SET transcript_status = NULL
         WHERE transcript_status = 'pending'
           AND transcript_origin = 'server'
           AND COALESCE(transcript, '') = ''
           AND (has_transcript IS NULL OR has_transcript IN (0, '0'))
      `);
    },
  },
  {
    version: 38,
    run: async (db) => {
      // Rotulo livre editavel de uma entidade (escola, gata, personagem) e a
      // memoria de rejeicoes do dono. O rotulo e so exibicao; a rejeicao diz
      // "este nome nunca e entidade deste tipo" e e aplicada antes de persistir.
      if (!(await columnExists(db, 'entities', 'label'))) {
        await db.execAsync("ALTER TABLE entities ADD COLUMN label TEXT NOT NULL DEFAULT ''");
      }
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS entity_rejections (
          kind       TEXT NOT NULL,
          name       TEXT NOT NULL,
          name_key   TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT '',
          PRIMARY KEY (kind, name_key)
        );
        CREATE INDEX IF NOT EXISTS idx_entity_rejections_kind_updated
          ON entity_rejections (kind, updated_at);
      `);
      if (!(await columnExists(db, 'entity_outbox', 'label'))) {
        await db.execAsync('ALTER TABLE entity_outbox ADD COLUMN label TEXT');
      }
      if (!(await columnExists(db, 'entity_outbox', 'next_kind'))) {
        await db.execAsync('ALTER TABLE entity_outbox ADD COLUMN next_kind TEXT');
      }
    },
  },
  {
    version: 39,
    run: async (db) => {
      // Detalhe do resumo automatico do caderno: `concise` (padrao) ou `full`.
      // Cadernos antigos nascem enxutos, como o servidor faz.
      if (!(await columnExists(db, 'notebooks', 'summary_detail'))) {
        await db.execAsync(
          "ALTER TABLE notebooks ADD COLUMN summary_detail TEXT NOT NULL DEFAULT 'concise'",
        );
      }
    },
  },
  {
    version: 40,
    run: async (db) => {
      // Detalhe do resumo automatico do projeto (entrada): `concise` (padrao) ou `full`.
      if (!(await columnExists(db, 'recordings', 'summary_detail'))) {
        await db.execAsync(
          "ALTER TABLE recordings ADD COLUMN summary_detail TEXT NOT NULL DEFAULT 'concise'",
        );
      }
      if (!(await columnExists(db, 'recordings', 'summary_detail_dirty'))) {
        await db.execAsync(
          'ALTER TABLE recordings ADD COLUMN summary_detail_dirty INTEGER NOT NULL DEFAULT 0',
        );
      }
    },
  },
  {
    version: 41,
    run: async (db) => {
      // Icone de pagina da entrada (emoji ou texto curto). Vazio deixa o
      // fallback para a tela; notas antigas nascem sem icone.
      if (!(await columnExists(db, 'recordings', 'icon'))) {
        await db.execAsync("ALTER TABLE recordings ADD COLUMN icon TEXT NOT NULL DEFAULT ''");
      }
    },
  },
];

/** Versao que o banco tem depois de aplicar a lista inteira. */
export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

/** Migracoes que ainda faltam aplicar, em ordem. */
export function migrationsToRun(from: number): Migration[] {
  return MIGRATIONS.filter((migration) => migration.version > from);
}

/**
 * Aplica o que falta, uma transacao por versao.
 *
 * Quem chama decide o modo da transacao: o app usa exclusiva fora do web, o
 * navegador usa a comum. A regra (migra, depois carimba `user_version`) fica
 * aqui, num lugar so.
 */
export async function applyMigrations(
  db: SchemaDb,
  inTransaction: (task: () => Promise<void>) => Promise<void>,
): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  for (const migration of migrationsToRun(version)) {
    await inTransaction(async () => {
      await migration.run(db);
      await db.execAsync(`PRAGMA user_version = ${migration.version}`);
    });
    version = migration.version;
  }
  return version;
}
