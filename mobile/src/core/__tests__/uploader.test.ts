import { ApiError, type CreateUploadBody, type DyariumApi } from '../api';
import { uploadRecording, type UploadFileIO } from '../uploader';

class FakeApi {
  offset = 0;
  puts: number[] = [];
  created = 0;
  conflictOnce = -1;

  constructor(private total: number) {}

  createUpload = jest.fn(async (_body: CreateUploadBody) => {
    this.created += 1;
    this.offset = 0;
    return { id: 'up1', offset: 0, expires_at: '' };
  });

  getUpload = jest.fn(async () => ({
    id: 'up1',
    status: 'open',
    offset: this.offset,
    size_bytes: this.total,
    expires_at: '',
  }));

  putChunk = jest.fn(async (_id: string, off: number, bytes: Uint8Array) => {
    if (off === this.conflictOnce) {
      this.conflictOnce = -1;
      throw new ApiError(409, 'offset_mismatch', 'mismatch', this.offset);
    }
    this.puts.push(off);
    this.offset = off + bytes.length;
    return { id: 'up1', offset: this.offset, received_bytes: this.offset };
  });

  completeUpload = jest.fn(async () => ({ entry_id: 'en1', status: 'queued' }));

  asApi(): DyariumApi {
    return this as unknown as DyariumApi;
  }
}

function memFile(data: Uint8Array): UploadFileIO {
  return {
    size: async () => data.length,
    read: async (_path, off, len) => data.slice(off, off + len),
  };
}

function payload(n: number): Uint8Array {
  return Uint8Array.from({ length: n }, (_, i) => i % 256);
}

const input = {
  clientKey: 'ck_1',
  filename: 'nota.aac',
  contentType: 'audio/aac',
  title: '10/10/2026 21:00',
  recordedAt: '2026-10-10T21:00:00.000Z',
  createdAt: '2026-10-10T20:55:00.000Z',
  source: 'share' as const,
  localPath: 'sess/r1/recording.aac',
  sizeBytes: 10,
};

describe('uploadRecording', () => {
  it('envia chunks sequenciais e conclui', async () => {
    const server = new FakeApi(10);
    const progress: number[] = [];
    const onCreated = jest.fn();
    const result = await uploadRecording(input, {
      api: server.asApi(),
      file: memFile(payload(10)),
      chunkSize: 4,
      callbacks: { onUploadCreated: onCreated, onProgress: (sent) => { progress.push(sent); } },
    });

    expect(server.puts).toEqual([0, 4, 8]);
    expect(result.entryId).toBe('en1');
    expect(onCreated).toHaveBeenCalledWith('up1', 0);
    expect(progress[progress.length - 1]).toBe(10);
    expect(server.createUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        created_at: input.createdAt,
        source: 'share',
      }),
    );
  });

  it('retoma de um upload existente usando o offset do servidor', async () => {
    const server = new FakeApi(10);
    server.offset = 5;
    const result = await uploadRecording(
      { ...input, uploadId: 'up1', offset: 0 },
      { api: server.asApi(), file: memFile(payload(10)), chunkSize: 4 },
    );
    expect(server.created).toBe(0); // nao cria de novo
    expect(server.puts).toEqual([5, 9]);
    expect(result.entryId).toBe('en1');
  });

  it('rele do offset devolvido em 409', async () => {
    const server = new FakeApi(10);
    server.conflictOnce = 0; // primeiro PUT em 0 conflita, servidor diz offset 0
    const result = await uploadRecording(input, {
      api: server.asApi(),
      file: memFile(payload(10)),
      chunkSize: 4,
    });
    expect(server.puts).toEqual([0, 4, 8]);
    expect(result.entryId).toBe('en1');
  });

  it('propaga erro que nao seja 409', async () => {
    const server = new FakeApi(10);
    server.putChunk.mockImplementationOnce(async () => {
      throw new ApiError(500, 'internal', 'erro interno');
    });
    await expect(
      uploadRecording(input, { api: server.asApi(), file: memFile(payload(10)), chunkSize: 4 }),
    ).rejects.toMatchObject({ status: 500 });
  });
});
