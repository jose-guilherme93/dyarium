import { concatenateSegments, type ConcatIO } from '../concat';

class MemFS implements ConcatIO {
  files: Record<string, Uint8Array> = {};
  out: number[] = [];

  async listSegments(dir: string): Promise<string[]> {
    return Object.keys(this.files).filter((k) => k.startsWith(dir));
  }
  async size(path: string): Promise<number> {
    return this.files[path].length;
  }
  async read(path: string, offset: number, length: number): Promise<Uint8Array> {
    return this.files[path].slice(offset, offset + length);
  }
  async append(_outPath: string, bytes: Uint8Array): Promise<void> {
    this.out.push(...bytes);
  }
}

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe('concatenateSegments', () => {
  it('junta os segmentos na ordem lexicografica', async () => {
    const fs = new MemFS();
    fs.files['sess/seg-000.aac'] = bytes(1, 2, 3);
    fs.files['sess/seg-001.aac'] = bytes(4, 5);
    fs.files['sess/seg-002.aac'] = bytes(6);
    const total = await concatenateSegments('sess/', 'out.aac', fs);
    expect(total).toBe(6);
    expect(fs.out).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('le em pedacos respeitando o chunkSize', async () => {
    const fs = new MemFS();
    fs.files['d/seg-000.aac'] = bytes(1, 2, 3, 4, 5);
    const total = await concatenateSegments('d/', 'out.aac', fs, 2);
    expect(total).toBe(5);
    expect(fs.out).toEqual([1, 2, 3, 4, 5]);
  });

  it('retorna 0 quando nao ha segmentos', async () => {
    const fs = new MemFS();
    expect(await concatenateSegments('vazio/', 'out.aac', fs)).toBe(0);
    expect(fs.out).toEqual([]);
  });
});
