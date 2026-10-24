import { fallbackCorners, pressRippleMode, rippleCorners, rippleShape } from '../Press';

describe('rippleCorners', () => {
  it('usa o raio unico do alvo', () => {
    expect(rippleCorners({ backgroundColor: '#000', borderRadius: 14 })).toEqual({
      borderRadius: 14,
    });
  });

  it('preserva cantos diferentes', () => {
    expect(
      rippleCorners({ borderTopLeftRadius: 4, borderBottomRightRadius: 8 }),
    ).toEqual({
      borderTopLeftRadius: 4,
      borderTopRightRadius: undefined,
      borderBottomLeftRadius: undefined,
      borderBottomRightRadius: 8,
    });
  });

  it('nao recorta alvos sem raio', () => {
    expect(rippleCorners({ backgroundColor: '#000' })).toBeNull();
    expect(rippleCorners(undefined)).toBeNull();
  });
});

describe('fallbackCorners', () => {
  it('faz botoes de icone quadrados virarem circulos', () => {
    expect(fallbackCorners(38, 38)).toEqual({ borderRadius: 19 });
    expect(fallbackCorners(40, 40)).toEqual({ borderRadius: 20 });
  });

  it('arredonda alvos retangulares sem canto reto', () => {
    expect(fallbackCorners(220, 38)).toEqual({ borderRadius: 14 });
    expect(fallbackCorners(38, 90)).toEqual({ borderRadius: 14 });
  });

  it('nao trata alvos grandes e quadrados como icone', () => {
    expect(fallbackCorners(300, 300)).toEqual({ borderRadius: 14 });
  });

  it('usa o arredondamento padrao sem medida', () => {
    expect(fallbackCorners(0, 0)).toEqual({ borderRadius: 14 });
  });
});

describe('rippleShape', () => {
  it('prefere o raio declarado pelo alvo', () => {
    expect(rippleShape({ borderRadius: 20 }, 38, 38)).toEqual({ borderRadius: 20 });
  });

  it('deduz a forma do tamanho quando o alvo nao declara raio', () => {
    expect(rippleShape(undefined, 38, 38)).toEqual({ borderRadius: 19 });
    expect(rippleShape(undefined, 220, 44)).toEqual({ borderRadius: 14 });
  });
});

describe('pressRippleMode', () => {
  it('usa o ripple recortado em qualquer alvo com feedback', () => {
    expect(pressRippleMode(undefined, true)).toBe('rounded');
    expect(pressRippleMode({ borderless: false }, true)).toBe('rounded');
  });

  it('mantem o nativo so para borderless', () => {
    expect(pressRippleMode({ borderless: true }, true)).toBe('native');
  });

  it('desliga o feedback quando pedido', () => {
    expect(pressRippleMode(undefined, false)).toBe('none');
  });
});
