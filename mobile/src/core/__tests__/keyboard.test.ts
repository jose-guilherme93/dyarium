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
  const base = { editorTop: 200, scrollY: 0, viewport: 800, bottomInset: 96, lineHeight: 28, topInset: 16 };

  it('cursor ja visivel nao rola', () => {
    expect(caretScrollTarget({ ...base, caret: 400 })).toBeNull();
  });

  it('cursor embaixo do teclado rola para o meio da area visivel', () => {
    // centro = 16 + (800-96-16)/2 = 360; bottom = 200+600 = 800 -> 440.
    expect(caretScrollTarget({ ...base, caret: 600 })).toBe(440);
  });

  it('cursor acima da area visivel volta para a linha atual', () => {
    // bottom = 300; centro 360 -> alvo 0 (nao da para rolar negativo).
    expect(caretScrollTarget({ ...base, scrollY: 400, caret: 100 })).toBe(0);
  });

  it('no topo da nota nao rola para lugar nenhum', () => {
    expect(caretScrollTarget({ ...base, editorTop: 0, caret: 10, topInset: 16 })).toBeNull();
  });

  it('considera a rolagem atual (nao rola duas vezes)', () => {
    expect(caretScrollTarget({ ...base, scrollY: 100, caret: 600 })).toBeNull();
  });
});
