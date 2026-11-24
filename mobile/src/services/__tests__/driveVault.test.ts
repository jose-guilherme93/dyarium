import {
  deriveVaultKey,
  formatRecoveryCode,
  newRecoveryCode,
  openBytes,
  sealBytes,
  vaultIdFromCode,
} from '@/core/vaultCode';
import type { Recording } from '@/core/types';

const mockStore = {
  files: new Map<string, Uint8Array>(),
  driveFiles: new Map<string, { name: string; bytes: Uint8Array }>(),
  puts: [] as { name: string; bytes: Uint8Array }[],
};

const mockLocal = {
  notes: new Map<string, Recording>(),
  notebooks: new Set<string>(),
};

const mockFlags = new Map<string, string>();
const mockCreatedNotebooks: { id: string; name: string; kind?: string }[] = [];

jest.mock('../driveClient', () => {
  class DriveError extends Error {
    kind = 'http';
    status?: number;
  }
  class DriveClient {
    async ensureFolder(name?: string): Promise<string> {
      return name === 'attachments' ? 'attachments-folder' : 'root';
    }
    async list(folder: string) {
      if (folder !== 'attachments-folder') return [];
      return [...mockStore.driveFiles.entries()].map(([id, file]) => ({ id, name: file.name }));
    }
    async findChild(_root: string, name: string) {
      const bytes = mockStore.files.get(name);
      return bytes ? { id: name, name, size: String(bytes.length) } : undefined;
    }
    async download(id: string): Promise<Uint8Array> {
      const bytes = mockStore.files.get(id) ?? mockStore.driveFiles.get(id)?.bytes;
      if (!bytes) throw new DriveError('Drive 404');
      return bytes;
    }
    async put(_root: string, name: string, bytes: Uint8Array) {
      mockStore.files.set(name, bytes);
      mockStore.puts.push({ name, bytes });
      return { id: name, name, size: String(bytes.length) };
    }
  }
  return { DriveClient, DriveError };
});

jest.mock('../driveAuth', () => ({
  getDriveAccessToken: jest.fn(async () => 'token'),
}));

jest.mock('../db', () => ({
  clockNow: jest.fn(async () => 'hlc-local'),
  getAppFlag: jest.fn(async (key: string) => mockFlags.get(key) ?? null),
  setAppFlag: jest.fn(async (key: string, value: string) => {
    mockFlags.set(key, value);
  }),
  listRecordings: jest.fn(async (includeDeleted = false) =>
    [...mockLocal.notes.values()].filter((note) => includeDeleted || !note.deletedAt),
  ),
  getRecording: jest.fn(async (id: string) => mockLocal.notes.get(id) ?? null),
  upsertRecording: jest.fn(async (note: Recording) => {
    mockLocal.notes.set(note.id, note);
  }),
}));

jest.mock('../notebooks', () => ({
  listNotebooks: jest.fn(async () => [...mockLocal.notebooks].map((id) => ({ id }))),
  restoreLocalNotebook: jest.fn(async (notebook: { id: string; name: string; kind?: string }) => {
    mockLocal.notebooks.add(notebook.id);
    mockCreatedNotebooks.push(notebook);
  }),
}));

jest.mock('../files', () => ({
  sessionDirectory: jest.fn(() => ({})),
  sessionDirUri: jest.fn((id: string) => `file:///recordings/${id}`),
}));

jest.mock('../attachments', () => ({
  cachedAttachmentUri: jest.fn(() => null),
  saveCachedAttachment: jest.fn(async () => undefined),
}));

jest.mock('expo-file-system', () => ({
  Directory: class {},
  File: class {
    exists = false;
    uri = '';
    create() {}
    open() {
      return { writeBytes() {}, close() {} };
    }
    move() {}
  },
  FileMode: { Append: 1 },
}));

jest.mock('expo-crypto', () => ({
  getRandomBytes: (length: number) => new Uint8Array(length).fill(7),
}));

import { openDriveVault, readVaultSummary, VaultSyncError } from '../driveVault';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function recording(overrides: Partial<Recording> = {}): Recording {
  return {
    id: 'n1',
    title: 'local',
    recordedAt: '2026-11-20T00:00:00.000Z',
    dir: '',
    segmentCount: 0,
    status: 'completed',
    source: 'text',
    offset: 0,
    attempts: 0,
    createdAt: '2026-11-20T00:00:00.000Z',
    updatedAt: '2026-11-20T00:00:00.000Z',
    ...overrides,
  };
}

function remoteSnapshot(notes: unknown[]): Uint8Array {
  return encoder.encode(
    JSON.stringify({
      version: 1,
      vaultId: vaultIdFromCode(code),
      createdAt: '2026-11-22T00:00:00.000Z',
      notes,
    }),
  );
}

const code = newRecoveryCode(() => Uint8Array.from({ length: 15 }, (_, index) => index + 1));
const key = deriveVaultKey(code);

function putVault(notes: unknown[], manifest?: unknown): void {
  mockStore.files.set('key.txt', encoder.encode(formatRecoveryCode(code)));
  mockStore.files.set('backup.enc', sealBytes(remoteSnapshot(notes), key, () => new Uint8Array(12).fill(1)));
  if (manifest) mockStore.files.set('manifest.json', encoder.encode(JSON.stringify(manifest)));
}

beforeEach(() => {
  mockStore.files.clear();
  mockStore.driveFiles.clear();
  mockStore.puts.length = 0;
  mockLocal.notes.clear();
  mockLocal.notebooks.clear();
  mockFlags.clear();
  mockCreatedNotebooks.length = 0;
});

describe('abrir o cofre do Drive', () => {
  it('restaura a nota remota mais nova, preserva a local e sobe a uniao', async () => {
    mockLocal.notes.set('n1', recording({ title: 'local antigo' }));
    mockLocal.notes.set('n2', recording({ id: 'n2', title: 'local novo', updatedAt: '2026-11-23T00:00:00.000Z' }));
    mockLocal.notes.set('n3', recording({ id: 'n3', title: 'so local' }));
    putVault([
      {
        id: 'n1',
        title: 'remoto novo',
        recordedAt: '2026-11-21T00:00:00.000Z',
        updatedAt: '2026-11-22T00:00:00.000Z',
        text: 'corpo remoto',
        notebookId: 'nb1',
      },
      {
        id: 'n2',
        title: 'remoto velho',
        recordedAt: '2026-11-21T00:00:00.000Z',
        updatedAt: '2026-11-21T00:00:00.000Z',
      },
    ], {
      version: 4,
      updated_at: '2026-11-22T00:00:00.000Z',
      files: [
        {
          path: 'books/Livro/001-capitulo.md.enc',
          id: 'n2',
          kind: 'chapter',
          sha256: 'a'.repeat(64),
          size: 10,
          updated_at: '2026-11-21T00:00:00.000Z',
        },
      ],
    });

    const result = await openDriveVault();

    expect(result.created).toBe(false);
    expect(mockLocal.notes.get('n1')).toMatchObject({
      title: 'remoto novo',
      text: 'corpo remoto',
      updatedAt: '2026-11-22T00:00:00.000Z',
      updatedHlc: 'hlc-local',
    });
    expect(mockLocal.notes.get('n2')?.title).toBe('local novo');
    expect(mockLocal.notes.get('n3')?.title).toBe('so local');
    expect(mockCreatedNotebooks).toEqual([expect.objectContaining({ id: 'nb1', name: 'Importado' })]);
    expect(result.restored).toMatchObject({ notes: 1, skipped: 1, notebooks: 1 });

    const pushed = mockStore.puts.find((put) => put.name === 'backup.enc');
    expect(pushed).toBeTruthy();
    const written = JSON.parse(decoder.decode(openBytes(pushed!.bytes, key))) as {
      notes: { id: string; title: string }[];
    };
    expect(written.notes.map((note) => note.id)).toEqual(['n1', 'n2', 'n3']);
    expect(written.notes.find((note) => note.id === 'n2')?.title).toBe('local novo');

    expect(await readVaultSummary()).toMatchObject({ notes: 3 });
    expect(mockFlags.get('drive.vaultId')).toBe(vaultIdFromCode(code));
  });

  it('nao reescreve o retrato quando a uniao e igual', async () => {
    putVault([
      {
        id: 'n1',
        title: 'igual',
        recordedAt: '2026-11-21T00:00:00.000Z',
        updatedAt: '2026-11-22T00:00:00.000Z',
        notebookId: 'notas-ao-acaso',
        text: 'corpo',
      },
    ]);
    mockLocal.notes.set(
      'n1',
      recording({
        title: 'igual',
        text: 'corpo',
        notebookId: 'notas-ao-acaso',
        recordedAt: '2026-11-21T00:00:00.000Z',
        updatedAt: '2026-11-22T00:00:00.000Z',
      }),
    );

    const result = await openDriveVault();
    expect(result.pushed).toBeNull();
    expect(mockStore.puts.filter((put) => put.name === 'backup.enc')).toHaveLength(0);
  });

  it('cria o cofre quando o Drive ainda nao tem key.txt', async () => {
    mockLocal.notes.set('n1', recording({ title: 'primeira' }));

    const result = await openDriveVault();

    expect(result.created).toBe(true);
    expect(mockStore.files.has('key.txt')).toBe(true);
    expect(mockStore.files.has('backup.enc')).toBe(true);
    const createdCode = decoder.decode(mockStore.files.get('key.txt')!).trim();
    const createdKey = deriveVaultKey(createdCode);
    const written = JSON.parse(
      decoder.decode(openBytes(mockStore.files.get('backup.enc')!, createdKey)),
    ) as { notes: { id: string; title: string }[] };
    expect(written.notes).toEqual([expect.objectContaining({ id: 'n1', title: 'primeira' })]);
  });

  it('recusa outro cofre no mesmo aparelho sem escrever nada', async () => {
    mockFlags.set('drive.vaultId', 'deadbeef00');
    putVault([]);

    await expect(openDriveVault()).rejects.toMatchObject({
      name: 'VaultSyncError',
      kind: 'mismatch',
    });
    expect(mockStore.puts).toHaveLength(0);
  });

  it('nao aplica nada quando o retrato esta corrompido', async () => {
    mockStore.files.set('key.txt', encoder.encode(formatRecoveryCode(code)));
    mockStore.files.set('backup.enc', new Uint8Array([1, 2, 3, 4]));
    mockLocal.notes.set('n1', recording({ title: 'local' }));

    const error = await openDriveVault().catch((caught) => caught as VaultSyncError);
    expect(error).toBeInstanceOf(VaultSyncError);
    expect((error as VaultSyncError).kind).toBe('corrupt');
    expect(mockLocal.notes.get('n1')?.title).toBe('local');
    expect(mockStore.puts).toHaveLength(0);
  });
});


  it('baixa anexo pelo nome no Drive, nao pelo id do produto', async () => {
    putVault(
      [
        {
          id: 'n1',
          title: 'com audio',
          recordedAt: '2026-11-21T00:00:00.000Z',
          updatedAt: '2026-11-22T00:00:00.000Z',
        },
      ],
      {
        version: 4,
        updated_at: '2026-11-22T00:00:00.000Z',
        files: [
          {
            path: 'attachments/att_audio.aac.enc',
            id: 'att_audio',
            kind: 'attachment',
            entry_id: 'n1',
            content_type: 'audio/aac',
            sha256: 'a'.repeat(64),
            size: 4,
            updated_at: '2026-11-22T00:00:00.000Z',
          },
          {
            path: 'attachments/att_img.jpg.enc',
            id: 'att_img',
            kind: 'attachment',
            entry_id: 'n1',
            content_type: 'image/jpeg',
            sha256: 'b'.repeat(64),
            size: 4,
            updated_at: '2026-11-22T00:00:00.000Z',
          },
        ],
      },
    );
    // O id do produto nao e o id do arquivo no Drive; o nome e o que liga.
    mockStore.driveFiles.set('drive-id-audio', {
      name: 'att_audio.aac.enc',
      bytes: new Uint8Array([1, 2, 3, 4]),
    });
    mockStore.driveFiles.set('drive-id-img', {
      name: 'att_img.jpg.enc',
      bytes: new Uint8Array([5, 6, 7, 8]),
    });

    const result = await openDriveVault();

    expect(result.restored.attachments).toBe(2);
    expect(result.restored.failedAttachments).toBe(0);
    expect(mockLocal.notes.get('n1')?.status).toBe('completed');
  });
