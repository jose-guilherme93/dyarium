import { concatenateSegments, isAdtsHeader, type ConcatIO } from '../concat';

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

/** MemFS que devolve menos bytes do que o pedido (truncado) no meio do segmento. */
class TruncatedFS implements ConcatIO {
  files: Record<string, Uint8Array> = {};
  out: number[] = [];

  async listSegments(dir: string): Promise<string[]> {
    return Object.keys(this.files).filter((k) => k.startsWith(dir));
  }
  async size(path: string): Promise<number> {
    return this.files[path].length;
  }
  async read(_path: string, offset: number, length: number): Promise<Uint8Array> {
    const full = this.files[_path].slice(offset, offset + length);
    // devolve so metade dos bytes pedidos (ou zero quando nao houver mais)
    return full.slice(0, Math.max(0, Math.floor(full.length / 2)));
  }
  async append(_outPath: string, bytes: Uint8Array): Promise<void> {
    this.out.push(...bytes);
  }
}

/** MemFS que devolve mais bytes do que o pedido. */
class ExcessFS implements ConcatIO {
  files: Record<string, Uint8Array> = {};
  out: number[] = [];

  async listSegments(dir: string): Promise<string[]> {
    return Object.keys(this.files).filter((k) => k.startsWith(dir));
  }
  async size(path: string): Promise<number> {
    return this.files[path].length;
  }
  async read(_path: string, _offset: number, length: number): Promise<Uint8Array> {
    // devorce o dobro dos bytes pedidos (defeito de IO)
    return new Uint8Array(length * 2);
  }
  async append(_outPath: string, bytes: Uint8Array): Promise<void> {
    this.out.push(...bytes);
  }
}

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe('isAdtsHeader', () => {
  it('aceita sync word valida', () => {
    expect(isAdtsHeader(0xff, 0xf1)).toBe(true);
    expect(isAdtsHeader(0xff, 0xf9)).toBe(true);
  });

  it('rejeita cabecalho invalido', () => {
    expect(isAdtsHeader(0x00, 0x00)).toBe(false);
    expect(isAdtsHeader(0xff, 0x0f)).toBe(false);
  });
});

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

  it('lanca quando o segmento esta vazio (size 0)', async () => {
    const fs = new MemFS();
    fs.files['s/seg-000.aac'] = bytes();
    await expect(concatenateSegments('s/', 'out.aac', fs)).rejects.toThrow();
  });

  it('lanca quando read devolve menos bytes que o pedido (truncado)', async () => {
    const fs = new TruncatedFS();
    fs.files['s/seg-000.aac'] = bytes(1, 2, 3, 4);
    await expect(concatenateSegments('s/', 'out.aac', fs)).rejects.toThrow('segmento truncado');
  });

  it('lanca quando read devolve mais bytes que o pedido', async () => {
    const fs = new ExcessFS();
    fs.files['s/seg-000.aac'] = bytes(1, 2, 3, 4);
    await expect(concatenateSegments('s/', 'out.aac', fs)).rejects.toThrow();
  });
});
