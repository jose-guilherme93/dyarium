import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./design-tokens.mjs', import.meta.url));
const root = dirname(dirname(script));

const read = (path) => readFileSync(join(root, path), 'utf8');
const tokens = JSON.parse(read('docs/design/tokens.json'));
const icons = JSON.parse(read('docs/design/icons.json'));

test('arquivos gerados estao em sincronia com docs/design/tokens.json', () => {
  const result = spawnSync(process.execPath, [script, '--check'], {
    cwd: root,
    encoding: 'utf8',
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert.equal(result.status, 0, `drift nos tokens gerados:\n${output}`);
});

test('saudacao e o maior tipo e continua em peso 600', () => {
  const greeting = tokens.type.greeting;
  assert.ok(greeting, 'type.greeting ausente');
  const maior = Math.max(...Object.values(tokens.type).map((item) => item.size));
  assert.equal(greeting.size, maior);
  assert.equal(greeting.weight, 600);
});

test('leitura declara familia serifada, medida e entrelinha', () => {
  const reading = tokens.reading;
  assert.ok(reading, 'reading ausente');
  assert.match(reading.stack, /Newsreader/);
  assert.equal(typeof reading.size, 'number');
  assert.equal(reading.weight, 400);
  assert.ok(reading.lineHeight > 1.4, 'leitura precisa de entrelinha propria');
  assert.equal(typeof reading.measure, 'number');
});

test('paleta declara sobreposicao nos tres temas', () => {
  for (const theme of ['light', 'dark', 'amoled']) {
    assert.match(String(tokens.palettes[theme].overlay), /^rgba?\(/, `overlay em ${theme}`);
  }
});

test('camadas, movimento e aviso existem com ordem coerente', () => {
  const layer = tokens.layer;
  assert.ok(layer.content < layer.sheet, 'folha acima do conteudo');
  assert.ok(layer.sheet < layer.dialog, 'dialogo acima da folha');
  assert.ok(layer.dialog < layer.notice, 'aviso acima do dialogo');
  assert.ok(layer.notice < layer.tooltip, 'tooltip acima do aviso');
  assert.ok(tokens.motion.fast < tokens.motion.base, 'movimento curto antes do base');
  assert.equal(typeof tokens.notice.dwell, 'number');
});

test('onda, estado e alvo de toque estao declarados', () => {
  assert.ok(tokens.wave.height > 0);
  assert.ok(tokens.wave.bar > 0);
  assert.ok(tokens.wave.idle < tokens.wave.played, 'tocada mais opaca que ociosa');
  assert.equal(tokens.row.touch, 44);
  assert.ok(tokens.state.bar > 0);
  assert.ok(tokens.state.disabled < 1);
});

test('tokens.css entrega as variaveis novas', () => {
  const css = read('web/src/ui/tokens.css');
  for (const name of [
    '--dy-font-reading',
    '--dy-reading-size',
    '--dy-reading-measure',
    '--dy-page-max',
    '--dy-measure',
    '--dy-gutter',
    '--dy-sidebar',
    '--dy-rail',
    '--dy-toolbar',
    '--dy-layer-sheet',
    '--dy-layer-dialog',
    '--dy-layer-notice',
    '--dy-layer-tooltip',
    '--dy-motion-fast',
    '--dy-motion-base',
    '--dy-notice-dwell',
    '--dy-wave-height',
    '--dy-wave-bar',
    '--dy-wave-gap',
    '--dy-state-disabled',
    '--dy-icon-box',
    '--dy-overlay',
  ]) {
    assert.match(css, new RegExp(`${name}:`), `${name} ausente no tokens.css`);
  }
  assert.match(css, /\.dy-reading\s*\{/, 'classe .dy-reading ausente');
  assert.match(css, /\.dy-greeting\s*\{/, 'classe .dy-greeting ausente');
  assert.match(css, /\.dy-greeting\s*\{[^}]*font-size:\s*48px/, 'saudação precisa de 48px');
  assert.match(css, /\.dy-clock\s*\{[^}]*font-family:\s*var\(--dy-font-mono\)/, 'relógio precisa ser mono');
  assert.match(css, /\.dy-clock\s*\{[^}]*font-variant-numeric:\s*tabular-nums/, 'relógio precisa de números tabulares');
});

test('design.ts entrega os grupos novos para o app', () => {
  const ts = read('mobile/src/theme/design.ts');
  for (const name of [
    'designReading',
    'designLayout',
    'designLayer',
    'designMotion',
    'designNotice',
    'designWave',
    'designState',
    'overlay',
    'greeting',
    'box',
  ]) {
    assert.match(ts, new RegExp(`\\b${name}\\b`), `${name} ausente no design.ts`);
  }
});

test('icones declaram desenho unico para os dois clientes', () => {
  assert.ok(icons.viewBox > 0);
  const names = Object.keys(icons.glyphs);
  assert.ok(names.length >= 24, 'conjunto de icones pequeno demais');
  for (const required of ['menu', 'plus', 'search', 'mic', 'more', 'sync', 'close', 'tree', 'book']) {
    assert.ok(names.includes(required), `icone obrigatorio ausente: ${required}`);
  }
  for (const [name, glyph] of Object.entries(icons.glyphs)) {
    assert.match(glyph.d, /^[Mm]/, `${name} precisa de um caminho SVG`);
  }
});

test('icones gerados para o web batem com docs/design/icons.json', () => {
  const generated = read('web/src/ui/iconGlyphs.ts');
  for (const name of Object.keys(icons.glyphs)) {
    assert.match(generated, new RegExp(`\\b${name}:`), `icone ${name} ausente no web`);
  }
  assert.match(generated, /export type IconName/);
});

test('galeria mostra leitura, onda, icones e inicio', () => {
  const html = read('docs/design/index.html');
  for (const marker of ['leitura', 'onda', 'ícones', 'início', 'camadas']) {
    assert.match(html, new RegExp(marker), `secao ausente na galeria: ${marker}`);
  }
});
