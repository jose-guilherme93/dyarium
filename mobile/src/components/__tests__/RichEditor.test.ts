/**
 * O editor rico roda num WebView que mede a propria altura e a reporta ao RN
 * (`postMessage`), e o RN cresce o container a partir dela. Sem `box-sizing:
 * border-box`, o padding de `#editor` soma ao `min-height: 100%` e cada ciclo do
 * ResizeObserver faz a nota crescer — a "nota que cresce sem parar".
 */

import { buildEditorHtml } from '../RichEditor';

describe('buildEditorHtml', () => {
  it('usa box-sizing: border-box no #editor, para a altura nao realimentar o container', () => {
    const html = buildEditorHtml('', '');
    expect(html).toMatch(/#editor\s*\{[^}]*box-sizing:\s*border-box/);
  });

  it('mantem o editor preenchendo a area (min-height 100%)', () => {
    const html = buildEditorHtml('', '');
    expect(html).toMatch(/#editor\s*\{[^}]*min-height:\s*100%/);
  });

  it('abre a foto no toque e o menu no toque longo, sem alca de redimensionar', () => {
    const html = buildEditorHtml('', '');
    expect(html).toContain('imageOpen:');
    expect(html).toContain('imageMenu:');
    expect(html).not.toContain('img-handle');
  });

  it('muda a largura e apaga a imagem por comando do app', () => {
    const html = buildEditorHtml('', '');
    expect(html).toContain('window.__setImageWidth');
    expect(html).toContain('window.__deleteImage');
  });

  it('reporta a posicao do cursor para a tela rolar a nota', () => {
    const html = buildEditorHtml('', '');
    expect(html).toContain('caret: caretBottom()');
  });
});
