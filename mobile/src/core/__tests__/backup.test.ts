import {
  backupMediaName,
  baseName,
  buildManifest,
  bytesToBase64,
  isBackupMediaName,
  joinUri,
  nameFromDocumentUri,
  orderForBackup,
  orderNotesForRestore,
  parseManifest,
  toRestoredRecording,
  type BackupNote,
} from '../backup';
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

  it('sem audio, limpa o filePath', () => {
    const restored = toRestoredRecording(base({ status: 'draft' }), 'file:///novo/r1/');
    expect(restored.filePath).toBeUndefined();
    expect(restored.status).toBe('draft');
  });
});
