import { clampImageWidth, IMAGE_WIDTH_OPTIONS, MAX_IMAGE_DIMENSION, resizeTarget } from '../image';

describe('resizeTarget', () => {
  it('nao mexe em imagem que ja cabe no limite', () => {
    expect(resizeTarget(1200, 900)).toBeNull();
    expect(resizeTarget(MAX_IMAGE_DIMENSION, 100)).toBeNull();
  });

  it('limita o maior lado preservando a proporcao (paisagem)', () => {
    expect(resizeTarget(4000, 3000)).toEqual({ width: 2048, height: 1536 });
  });

  it('limita o maior lado preservando a proporcao (retrato)', () => {
    expect(resizeTarget(3000, 4000)).toEqual({ width: 1536, height: 2048 });
  });

  it('aceita um teto proprio', () => {
    expect(resizeTarget(1000, 500, 500)).toEqual({ width: 500, height: 250 });
  });

  it('nao quebra com dimensao invalida', () => {
    expect(resizeTarget(0, 100)).toBeNull();
    expect(resizeTarget(100, -1)).toBeNull();
  });
});

describe('largura da imagem na nota', () => {
  it('oferece largura total, metade e miniatura', () => {
    expect(IMAGE_WIDTH_OPTIONS.map((option) => option.percent)).toEqual([100, 50, 30]);
  });

  it('prende a largura na faixa segura', () => {
    expect(clampImageWidth(100)).toBe(100);
    expect(clampImageWidth(50)).toBe(50);
    expect(clampImageWidth(5)).toBe(15);
    expect(clampImageWidth(180)).toBe(100);
    expect(clampImageWidth(NaN)).toBe(100);
  });
});
