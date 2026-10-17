import { caretScrollTarget, keyboardOverlap } from '../keyboard';

describe('keyboardOverlap', () => {
  it('janela ajustada (adjustResize): o teclado foi absorvido', () => {
    expect(keyboardOverlap(320, 800, 480)).toBe(0);
  });

  it('edge-to-edge: a janela nao encolheu, o teclado cobre tudo', () => {
    expect(keyboardOverlap(320, 800, 800)).toBe(320);
  });

  it('absorcao parcial: so sobra a parte que a janela nao absorveu', () => {
    expect(keyboardOverlap(320, 800, 660)).toBe(180);
  });

  it('sem teclado nao ha sobreposicao', () => {
    expect(keyboardOverlap(0, 800, 800)).toBe(0);
  });
});

describe('caretScrollTarget', () => {
  const base = { editorTop: 200, scrollY: 0, viewport: 800, bottomInset: 96 };

  it('cursor ja visivel nao rola', () => {
    expect(caretScrollTarget({ ...base, caret: 400 })).toBeNull();
  });

  it('cursor embaixo do teclado rola para ficar acima do limite', () => {
    // bottom = 200 + 600 = 800; limit = 800 - 96 = 704 -> rola 96.
    expect(caretScrollTarget({ ...base, caret: 600 })).toBe(96);
  });

  it('considera a rolagem atual (nao rola duas vezes)', () => {
    expect(caretScrollTarget({ ...base, scrollY: 100, caret: 600 })).toBeNull();
  });
});
