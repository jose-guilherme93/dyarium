import {
  backupFileName,
  baseName,
  buildManifest,
  joinUri,
  orderForBackup,
  originalFileName,
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

describe('nome dos arquivos no backup', () => {
  it('prefixa com o id e volta ao nome original', () => {
    expect(backupFileName('r1', 'recording.aac')).toBe('r1__recording.aac');
    expect(originalFileName('r1', 'r1__recording.aac')).toBe('recording.aac');
  });

  it('devolve o nome cheio quando o prefixo nao bate', () => {
    expect(originalFileName('r1', 'outro.aac')).toBe('outro.aac');
  });
});

describe('baseName e joinUri', () => {
  it('extrai o nome do arquivo', () => {
    expect(baseName('file:///doc/recordings/r1/recording.aac')).toBe('recording.aac');
    expect(baseName(undefined)).toBeUndefined();
  });

  it('junta evitando barra dupla', () => {
    expect(joinUri('file:///doc/r1/', 'a.aac')).toBe('file:///doc/r1/a.aac');
    expect(joinUri('file:///doc/r1', 'a.aac')).toBe('file:///doc/r1/a.aac');
  });
});

describe('manifesto', () => {
  const notes: BackupNote[] = [
    { recording: base(), audioFile: 'recording.aac', files: ['recording.aac', 'img_1.jpg'] },
  ];

  it('vai e volta', () => {
    const manifest = buildManifest(notes, new Date('2026-10-16T12:00:00.000Z'));
    const parsed = parseManifest(JSON.stringify(manifest));
    expect(parsed?.notes[0].recording.id).toBe('r1');
    expect(parsed?.notes[0].files).toEqual(['recording.aac', 'img_1.jpg']);
    expect(parsed?.createdAt).toBe('2026-10-16T12:00:00.000Z');
  });

  it('devolve null para lixo ou versao futura', () => {
    expect(parseManifest('nao-e-json')).toBeNull();
    expect(parseManifest('{"version":99,"notes":[]}')).toBeNull();
    expect(parseManifest('{"notes":[]}')).toBeNull();
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
