import {
  BACKUP_VERSION,
  backupEntryKeys,
  backupMediaName,
  baseName,
  buildManifest,
  bytesToBase64,
  filterKnowledge,
  isBackupMediaName,
  joinUri,
  nameFromDocumentUri,
  orderForBackup,
  orderNotesForRestore,
  parseManifest,
  toRestoredRecording,
  type BackupKnowledge,
  type BackupNote,
} from '../backup';
import { sha256Hex } from '../sha256';
import type { Recording } from '../types';

function base(overrides: Partial<Recording> = {}): Recording {
  return {
    id: 'r1',
    title: 'Nota',
    recordedAt: '2026-10-11T00:00:00.000Z',
    dir: 'file:///doc/recordings/r1/',
    segmentCount: 1,
    status: 'completed',
    offset: 0,
    attempts: 0,
    createdAt: '2026-10-11T00:00:00.000Z',
    updatedAt: '2026-10-11T00:00:00.000Z',
    ...overrides,
  };
}

function note(overrides: Partial<BackupNote> = {}): BackupNote {
  return {
    recording: base(),
    audioFile: 'recording.aac',
    files: [{ name: 'r1__abc__recording.aac', originalName: 'recording.aac', md5: 'abc', size: 10 }],
    ...overrides,
  };
}

describe('orderForBackup', () => {
  it('ordena da mais antiga para a mais nova', () => {
    const ordered = orderForBackup([
      base({ id: 'b', recordedAt: '2026-10-02T00:00:00.000Z' }),
      base({ id: 'a', recordedAt: '2026-10-01T00:00:00.000Z' }),
      base({ id: 'c', recordedAt: '2026-10-03T00:00:00.000Z' }),
    ]);
    expect(ordered.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('orderNotesForRestore', () => {
  it('reordena pelo recordedAt', () => {
    const ordered = orderNotesForRestore([
      note({ recording: base({ id: 'b', recordedAt: '2026-10-02T00:00:00.000Z' }) }),
      note({ recording: base({ id: 'a', recordedAt: '2026-10-01T00:00:00.000Z' }) }),
    ]);
    expect(ordered.map((n) => n.recording.id)).toEqual(['a', 'b']);
  });
});

describe('nome das midias', () => {
  it('monta e reconhece o nome com id e hash', () => {
    const name = backupMediaName('note_1', 'd41d8cd98f00b204e9800998ecf8427e', 'recording.aac');
    expect(name).toBe('note_1__d41d8cd98f00b204e9800998ecf8427e__recording.aac');
    expect(isBackupMediaName(name)).toBe(true);
  });

  it('nao confunde o manifesto nem nomes comuns', () => {
    expect(isBackupMediaName('manifest.json')).toBe(false);
    expect(isBackupMediaName('foto.jpg')).toBe(false);
    expect(isBackupMediaName('note_1__naoEhHash__foto.jpg')).toBe(false);
  });
});

describe('baseName, joinUri e nome de uri SAF', () => {
  it('extrai o nome do arquivo', () => {
    expect(baseName('file:///doc/recordings/r1/recording.aac')).toBe('recording.aac');
    expect(baseName(undefined)).toBeUndefined();
  });

  it('junta evitando barra dupla', () => {
    expect(joinUri('file:///doc/r1/', 'a.aac')).toBe('file:///doc/r1/a.aac');
    expect(joinUri('file:///doc/r1', 'a.aac')).toBe('file:///doc/r1/a.aac');
  });

  it('decodifica o ultimo segmento de um uri SAF', () => {
    expect(
      nameFromDocumentUri(
        'content://com.android.externalstorage.documents/tree/primary%3ADownload/document/primary%3ADownload%2Fr1__a__recording.aac',
      ),
    ).toBe('r1__a__recording.aac');
  });
});

describe('bytesToBase64', () => {
  it('codifica como o base64 padrao', () => {
    expect(bytesToBase64(new Uint8Array([77, 97, 110]))).toBe('TWFu');
    expect(bytesToBase64(new Uint8Array([77, 97]))).toBe('TWE=');
    expect(bytesToBase64(new Uint8Array([77]))).toBe('TQ==');
    expect(bytesToBase64(new Uint8Array([]))).toBe('');
  });
});

describe('manifesto', () => {
  it('vai e volta preservando ordem, hash e audio', () => {
    const manifest = buildManifest([note()], new Date('2026-10-16T12:00:00.000Z'), '0.2.1');
    const parsed = parseManifest(JSON.stringify(manifest));
    expect(parsed?.appVersion).toBe('0.2.1');
    expect(parsed?.notes[0].recording.id).toBe('r1');
    expect(parsed?.notes[0].audioFile).toBe('recording.aac');
    expect(parsed?.notes[0].files[0]).toEqual({
      name: 'r1__abc__recording.aac',
      originalName: 'recording.aac',
      md5: 'abc',
      size: 10,
    });
  });

  it('recusa lixo, versao errada e arquivos malformados', () => {
    expect(parseManifest('nao-e-json')).toBeNull();
    expect(parseManifest('{"version":99,"notes":[]}')).toBeNull();
    expect(parseManifest('{"notes":[]}')).toBeNull();
    expect(parseManifest('{"version":2}')).toBeNull();
    // arquivo sem hash e descartado
    const parsed = parseManifest(
      '{"version":2,"notes":[{"recording":{"id":"r1"},"files":[{"name":"x"},{"name":"a","originalName":"b","md5":"c","size":1}]}]}',
    );
    expect(parsed?.notes[0].files).toHaveLength(1);
  });
});

describe('toRestoredRecording', () => {
  it('refaz os caminhos e normaliza status de gravacao', () => {
    const restored = toRestoredRecording(
      base({ status: 'interrupted', filePath: 'file:///antigo/recording.aac' }),
      'file:///novo/r1/',
      'recording.aac',
    );
    expect(restored.dir).toBe('file:///novo/r1/');
    expect(restored.filePath).toBe('file:///novo/r1/recording.aac');
    expect(restored.status).toBe('recorded');
  });

  it('restaurar nao e editar: preserva a data real e solta o carimbo antigo', () => {
    const restored = toRestoredRecording(
      base({
        updatedAt: '2026-10-01T10:00:00.000Z',
        updatedHlc: '2026-10-01T10-0-abcd',
      }),
      'file:///novo/r1/',
    );
    expect(restored.updatedAt).toBe('2026-10-01T10:00:00.000Z');
    expect(restored.updatedHlc).toBeUndefined();
  });

  it('sem audio, limpa o filePath', () => {
    const restored = toRestoredRecording(base({ status: 'draft' }), 'file:///novo/r1/');
    expect(restored.filePath).toBeUndefined();
    expect(restored.status).toBe('draft');
  });
});

function knowledge(overrides: Partial<BackupKnowledge> = {}): BackupKnowledge {
  return {
    analyses: [
      {
        entryId: 'r1',
        title: 'Nota',
        recordedAt: '2026-10-11T00:00:00.000Z',
        payload: '{"summary":"ok"}',
        fetchedAt: '2026-10-12T00:00:00.000Z',
        origin: 'local',
        contentHash: 'abc',
      },
    ],
    analysisChunks: [
      {
        entryId: 'r1',
        blockIndex: 0,
        blockHash: 'h0',
        promptVersion: 3,
        model: 'modelo',
        status: 'ok',
        dropped: 1,
        payload: '{"items":[]}',
        updatedAt: '2026-10-12T00:00:00.000Z',
      },
    ],
    entities: [
      {
        id: 'ent_1',
        kind: 'person',
        name: 'Ana',
        label: '',
        icon: 'star',
        createdAt: '2026-10-11T00:00:00.000Z',
        updatedAt: '2026-10-12T00:00:00.000Z',
      },
    ],
    entityAliases: [
      {
        id: 'ali_1',
        entityId: 'ent_1',
        kind: 'person',
        name: 'Aninha',
        createdAt: '2026-10-11T00:00:00.000Z',
        updatedAt: '2026-10-12T00:00:00.000Z',
      },
    ],
    entryEntities: [
      {
        entryId: 'r1',
        entityId: 'ent_1',
        count: 2,
        relation: 'irma',
        sentiment: 0.5,
        createdAt: '2026-10-11T00:00:00.000Z',
      },
    ],
    ownerAliases: [{ name: 'Eu', createdAt: '2026-10-11T00:00:00.000Z', updatedAt: '' }],
    entityRejections: [
      {
        kind: 'person',
        name: 'Paulo',
        nameKey: 'paulo',
        createdAt: '2026-10-11T00:00:00.000Z',
        updatedAt: '',
      },
    ],
    graphLayout: [
      { key: 'default', data: '{"nodes":[]}', updatedAt: '2026-10-12T00:00:00.000Z' },
    ],
    transcriptSync: [{ entryId: 'r1', sourceAt: '2026-10-12T00:00:00.000Z' }],
    analysisSync: [{ entryId: 'r1', sourceAt: '2026-10-12T00:00:00.000Z' }],
    transcriptSyncEnv: [
      {
        serverId: 'srv_1',
        entryId: 'r1',
        sourceAt: '2026-10-12T00:00:00.000Z',
      },
    ],
    analysisSyncEnv: [
      {
        serverId: 'srv_1',
        entryId: 'r1',
        sourceAt: '2026-10-12T00:00:00.000Z',
      },
    ],
    author: { ownerName: 'Ana', allNotesMine: true },
    ...overrides,
  };
}

describe('conhecimento local no manifesto', () => {
  it('o manifesto atual leva analises, blocos e o mapa', () => {
    expect(BACKUP_VERSION).toBe(3);
    const manifest = buildManifest(
      [note()],
      new Date('2026-10-16T12:00:00.000Z'),
      '0.5.1',
      undefined,
      knowledge(),
    );
    const parsed = parseManifest(JSON.stringify(manifest));
    expect(parsed?.knowledge?.analyses[0]).toMatchObject({
      entryId: 'r1',
      origin: 'local',
      contentHash: 'abc',
    });
    expect(parsed?.knowledge?.analysisChunks).toHaveLength(1);
    expect(parsed?.knowledge?.entryEntities[0]).toMatchObject({
      entryId: 'r1',
      entityId: 'ent_1',
      count: 2,
      relation: 'irma',
    });
    expect(parsed?.knowledge?.author).toEqual({ ownerName: 'Ana', allNotesMine: true });
    expect(parsed?.knowledge?.transcriptSync).toEqual([
      { entryId: 'r1', sourceAt: '2026-10-12T00:00:00.000Z' },
    ]);
    expect(parsed?.knowledge?.analysisSyncEnv?.[0]?.serverId).toBe('srv_1');
  });

  it('backup v2 continua legivel, so que sem conhecimento', () => {
    const parsed = parseManifest(
      JSON.stringify({
        version: 2,
        createdAt: '2026-10-16T12:00:00.000Z',
        notes: [{ recording: { id: 'r1' }, files: [] }],
      }),
    );
    expect(parsed?.notes).toHaveLength(1);
    expect(parsed?.knowledge).toBeUndefined();
  });

  it('descarta linhas malformadas sem perder o resto', () => {
    const parsed = parseManifest(
      JSON.stringify({
        version: 3,
        createdAt: '2026-10-16T12:00:00.000Z',
        notes: [],
        knowledge: {
          analyses: [{ entryId: 'r1' }, { entryId: 'r2', payload: '{}' }],
          entities: [{ id: 'ent_1', kind: 'person' }, 42],
          entryEntities: [{ entryId: 'r1' }],
          graphLayout: [{ key: 'default', data: '{}' }],
        },
      }),
    );
    expect(parsed?.knowledge?.analyses.map((item) => item.entryId)).toEqual(['r2']);
    expect(parsed?.knowledge?.entities).toEqual([]);
    expect(parsed?.knowledge?.entryEntities).toEqual([]);
    expect(parsed?.knowledge?.graphLayout).toHaveLength(1);
  });

  it('o backup leva so o conhecimento das notas que estao nele', () => {
    const keys = backupEntryKeys([
      { recording: base({ id: 'r1', entryId: 'entrada-1' }) },
    ]);
    expect(keys).toEqual(new Set(['r1', 'entrada-1']));

    const filtered = filterKnowledge(
      knowledge({
        analyses: [
          ...knowledge().analyses,
          {
            entryId: 'outra',
            title: 'Fora',
            recordedAt: '',
            payload: '{}',
            fetchedAt: '',
            origin: 'server',
          },
        ],
      }),
      keys,
    );
    expect(filtered.analyses.map((item) => item.entryId)).toEqual(['r1']);
    expect(filtered.entryEntities).toHaveLength(1);
    expect(filtered.analysisChunks).toHaveLength(1);
    expect(filtered.transcriptSync).toHaveLength(1);
    expect(filtered.analysisSyncEnv).toHaveLength(1);
  });
});

describe('integridade do texto', () => {
  const text = 'hello';
  const textSha = sha256Hex(new TextEncoder().encode(text));

  it('buildManifest preserva textSha256 quando o BackupNote tem', () => {
    const manifest = buildManifest([
      note({ recording: base({ id: 'r1', text }), textSha256: textSha }),
    ], new Date('2026-10-16T12:00:00.000Z'), '0.2.1');

    expect(manifest.notes[0].textSha256).toBe(textSha);
  });

  it('parseManifest devolve textSha256 quando o JSON tem', () => {
    const parsed = parseManifest(JSON.stringify({
      version: 2,
      createdAt: '2026-10-16T12:00:00.000Z',
      notes: [{
        recording: { id: 'r1' },
        audioFile: 'recording.aac',
        textSha256: textSha,
        files: [{ name: 'r1__abc__recording.aac', originalName: 'recording.aac', md5: 'abc', size: 10 }],
      }],
    }));

    expect(parsed?.notes[0].textSha256).toBe(textSha);
  });

  it('parseManifest devolve undefined quando o JSON nao tem (compatibilidade)', () => {
    const parsed = parseManifest(JSON.stringify({
      version: 2,
      createdAt: '2026-10-16T12:00:00.000Z',
      notes: [{
        recording: { id: 'r1' },
        audioFile: 'recording.aac',
        files: [{ name: 'r1__abc__recording.aac', originalName: 'recording.aac', md5: 'abc', size: 10 }],
      }],
    }));

    expect(parsed?.notes[0].textSha256).toBeUndefined();
  });

  it('buildManifest/parseManifest arredondam textSha256 sem perda', () => {
    // Garante que o valor fixado na nota e reprisado em buildManifest e recoverado
    // imediatamente depois por parseManifest, com a cadeia intacta.
    const noteWithText: BackupNote = {
      recording: base({ id: 'r1', text }),
      audioFile: 'recording.aac',
      textSha256: textSha,
      files: [{ name: 'r1__abc__recording.aac', originalName: 'recording.aac', md5: 'abc', size: 10 }],
    };
    const manifest = buildManifest([noteWithText], new Date());
    const roundTrip = parseManifest(JSON.stringify(manifest));
    expect(roundTrip?.notes[0].textSha256).toBe(textSha);
  });
});
