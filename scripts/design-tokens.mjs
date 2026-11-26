#!/usr/bin/env node
/**
 * Gera os artefatos de design a partir de docs/design/tokens.json.
 *
 *   node scripts/design-tokens.mjs           escreve os tres arquivos
 *   node scripts/design-tokens.mjs --check   compara com o disco, sem escrever
 *
 * Saida deterministica: ordem fixa de chaves, LF e newline final, sem data nem
 * versao embutida. O --check depende disso para comparar byte a byte.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tokenFile = join(root, 'docs/design/tokens.json');
const iconFile = join(root, 'docs/design/icons.json');

const PALETTE_KEYS = [
  'surface',
  'surface-alt',
  'surface-raised',
  'line',
  'text',
  'text-muted',
  'primary',
  'primary-soft',
  'danger',
  'success',
  'warning',
  // Marca o build de desenvolvimento (nome com sufixo). Nao e cor de conteudo.
  'dev',
  'info',
  'overlay',
];
const THEMES = ['light', 'dark', 'amoled'];
const THEME_LABEL = { light: 'claro', dark: 'escuro', amoled: 'amoled' };
const TYPE_NAMES = ['greeting', 'clock', 'display', 'title', 'body', 'label', 'mono'];
const TYPE_META = {
  greeting: 'saudação',
  clock: 'relógio',
  display: 'display',
  title: 'título',
  body: 'corpo',
  label: 'rótulo',
  mono: 'mono',
};
const TYPE_SAMPLE = {
  greeting: 'Bom dia',
  clock: '14:07',
  display: 'Reunião com fornecedor',
  title: 'Ideia de captura offline',
  body: 'Conversa com o fornecedor sobre a entrega de março e o que ficou pendente na última reunião',
  label: 'em análise',
  mono: '12 mar · 14:07',
};
const BUTTON_VARIANTS = [
  { key: 'primary', label: 'primário', text: 'salvar' },
  { key: 'secondary', label: 'secundário', text: 'editar' },
  { key: 'ghost', label: 'fantasma', text: 'ver' },
];
const BUTTON_SIZES = ['sm', 'md', 'lg'];
const BUTTON_STATES = [
  { label: 'padrão', cls: '', disabled: false },
  { label: 'hover', cls: ' is-hover', disabled: false },
  { label: 'desabilitado', cls: '', disabled: true },
  { label: 'foco', cls: ' is-focus', disabled: false },
];

// Mesmos unicode-range do Inter em web/src/index.css: latin e latin-ext.
const LATIN_RANGE =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA,\n' +
  '    U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191,\n' +
  '    U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const LATIN_EXT_RANGE =
  'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7,\n' +
  '    U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F,\n' +
  '    U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F,\n' +
  '    U+A720-A7FF';

function fail(message) {
  process.stderr.write(`design-tokens: ${message}\n`);
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.length > 0 && !(args.length === 1 && args[0] === '--check')) {
  fail(`argumento desconhecido: ${args.join(' ')}\nuso: node scripts/design-tokens.mjs [--check]`);
}
const checkOnly = args[0] === '--check';

const tokens = JSON.parse(readFileSync(tokenFile, 'utf8'));
const icons = JSON.parse(readFileSync(iconFile, 'utf8'));

for (const theme of THEMES) {
  const palette = tokens.palettes?.[theme];
  if (!palette) fail(`paleta ausente no tokens.json: ${theme}`);
  for (const key of PALETTE_KEYS) {
    if (typeof palette[key] !== 'string') {
      fail(`cor ausente na paleta ${theme}: ${key}`);
    }
  }
}
for (const name of TYPE_NAMES) {
  if (!tokens.type?.[name]) fail(`tipo ausente no tokens.json: ${name}`);
}
for (const key of ['family', 'stack', 'size', 'weight', 'lineHeight', 'measure']) {
  if (tokens.reading?.[key] === undefined) fail(`reading.${key} ausente no tokens.json`);
}
if (!Array.isArray(tokens.space) || tokens.space.length === 0) {
  fail('array "space" ausente no tokens.json');
}
if (typeof tokens.font?.monoStack !== 'string') {
  fail('font.monoStack ausente no tokens.json');
}
for (const key of ['sm', 'md', 'lg', 'box', 'stroke', 'strokeDetail']) {
  if (typeof tokens.icon?.[key] !== 'number') {
    fail(`icon.${key} ausente no tokens.json`);
  }
}
for (const [section, keys] of [
  ['row', ['touch', 'dense']],
  ['tree', ['cell', 'rail', 'guide']],
  ['mark', ['size', 'stroke', 'tick']],
  ['layout', ['page', 'measure', 'gutter', 'sidebar', 'rail', 'toolbar', 'tab', 'spread', 'phone']],
  ['layer', ['content', 'rail', 'toolbar', 'sheet', 'dialog', 'notice', 'tooltip']],
  ['motion', ['fast', 'base']],
  ['notice', ['dwell']],
  ['wave', ['height', 'bar', 'gap', 'min', 'idle', 'played']],
  ['state', ['bar', 'disabled']],
  ['chart', ['height', 'top', 'base', 'labels', 'barMin', 'colMin', 'colMax', 'colRatio', 'sessionMin', 'sessionBarMin']],
]) {
  for (const key of keys) {
    if (typeof tokens[section]?.[key] !== 'number') {
      fail(`${section}.${key} ausente no tokens.json`);
    }
  }
}
if (typeof tokens.meter?.compose !== 'number') {
  fail('meter.compose ausente no tokens.json');
}
if (!icons.glyphs || Object.keys(icons.glyphs).length === 0) {
  fail('docs/design/icons.json precisa declarar glyphs');
}
for (const [name, glyph] of Object.entries(icons.glyphs)) {
  if (typeof glyph.d !== 'string' || !glyph.d.startsWith('M')) {
    fail(`icone ${name} precisa de um caminho SVG`);
  }
}

const num = (value) => String(value);

function letterSpacing(value) {
  return String(parseFloat(value));
}

function indent(text, prefix) {
  return text
    .split('\n')
    .map((line) => (line === '' ? line : prefix + line))
    .join('\n');
}

function fontFaces(urlBase) {
  return [
    '@font-face {',
    '  font-family: "Schibsted Grotesk";',
    `  src: url("${urlBase}/schibsted-grotesk.woff2") format("woff2");`,
    '  font-weight: 400 700;',
    '  font-style: normal;',
    '  font-display: swap;',
    `  unicode-range: ${LATIN_RANGE};`,
    '}',
    '',
    '@font-face {',
    '  font-family: "Schibsted Grotesk";',
    `  src: url("${urlBase}/schibsted-grotesk-ext.woff2") format("woff2");`,
    '  font-weight: 400 700;',
    '  font-style: normal;',
    '  font-display: swap;',
    `  unicode-range: ${LATIN_EXT_RANGE};`,
    '}',
    '',
    '@font-face {',
    '  font-family: "Newsreader";',
    `  src: url("${urlBase}/newsreader-roman-400-700.woff2") format("woff2");`,
    '  font-weight: 400 700;',
    '  font-style: normal;',
    '  font-display: swap;',
    '}',
    '',
    '@font-face {',
    '  font-family: "Newsreader";',
    `  src: url("${urlBase}/newsreader-italic-400-700.woff2") format("woff2");`,
    '  font-weight: 400 700;',
    '  font-style: italic;',
    '  font-display: swap;',
    '}',
  ].join('\n');
}

function paletteBlock(selector, palette) {
  const vars = PALETTE_KEYS.map((key) => `  --dy-${key}: ${palette[key]};`).join('\n');
  return `${selector} {\n${vars}\n}`;
}

function scaleBlock() {
  const lines = [];
  for (const value of tokens.space) {
    lines.push(`  --dy-space-${value}: ${value}px;`);
  }
  lines.push(`  --dy-radius-control: ${tokens.radius.control}px;`);
  lines.push(`  --dy-radius-surface: ${tokens.radius.surface}px;`);
  lines.push(`  --dy-focus-width: ${tokens.focus.width}px;`);
  lines.push(`  --dy-focus-offset: ${tokens.focus.offset}px;`);
  for (const size of BUTTON_SIZES) {
    lines.push(`  --dy-control-${size}: ${tokens.control[size]}px;`);
  }
  for (const size of BUTTON_SIZES) {
    lines.push(`  --dy-control-pad-${size}: ${tokens.control.padX[size]}px;`);
  }
  lines.push(`  --dy-meter-height: ${tokens.meter.height}px;`);
  lines.push(`  --dy-meter-gap: ${tokens.meter.gap}px;`);
  lines.push(`  --dy-meter-compose: ${tokens.meter.compose}px;`);
  lines.push(`  --dy-row-touch: ${tokens.row.touch}px;`);
  lines.push(`  --dy-row-dense: ${tokens.row.dense}px;`);
  lines.push(`  --dy-tree-cell: ${tokens.tree.cell}px;`);
  lines.push(`  --dy-tree-rail: ${tokens.tree.rail}px;`);
  lines.push(`  --dy-tree-guide: ${tokens.tree.guide}px;`);
  lines.push(`  --dy-mark-size: ${tokens.mark.size}px;`);
  lines.push(`  --dy-mark-stroke: ${tokens.mark.stroke}px;`);
  lines.push(`  --dy-mark-tick: ${tokens.mark.tick}px;`);
  lines.push(`  --dy-chart-height: ${tokens.chart.height}px;`);
  lines.push(`  --dy-chart-top: ${tokens.chart.top}px;`);
  lines.push(`  --dy-chart-base: ${tokens.chart.base}px;`);
  lines.push(`  --dy-chart-labels: ${tokens.chart.labels}px;`);
  lines.push(`  --dy-chart-bar-min: ${tokens.chart.barMin}px;`);
  lines.push(`  --dy-chart-col-min: ${tokens.chart.colMin}px;`);
  lines.push(`  --dy-chart-col-max: ${tokens.chart.colMax}px;`);
  lines.push(`  --dy-chart-col-ratio: ${tokens.chart.colRatio};`);
  lines.push(`  --dy-chart-session-min: ${tokens.chart.sessionMin}px;`);
  lines.push(`  --dy-chart-session-bar-min: ${tokens.chart.sessionBarMin}px;`);
  lines.push(`  --dy-icon-sm: ${tokens.icon.sm}px;`);
  lines.push(`  --dy-icon-md: ${tokens.icon.md}px;`);
  lines.push(`  --dy-icon-lg: ${tokens.icon.lg}px;`);
  lines.push(`  --dy-icon-box: ${tokens.icon.box}px;`);
  lines.push(`  --dy-icon-stroke: ${tokens.icon.stroke};`);
  lines.push(`  --dy-icon-stroke-detail: ${tokens.icon.strokeDetail};`);
  lines.push(`  --dy-font-reading: ${tokens.reading.stack};`);
  lines.push(`  --dy-reading-size: ${tokens.reading.size}px;`);
  lines.push(`  --dy-reading-weight: ${tokens.reading.weight};`);
  lines.push(`  --dy-reading-line-height: ${tokens.reading.lineHeight};`);
  lines.push(`  --dy-reading-measure: ${tokens.reading.measure}ch;`);
  lines.push(`  --dy-page-max: ${tokens.layout.page}px;`);
  lines.push(`  --dy-measure: ${tokens.layout.measure}ch;`);
  lines.push(`  --dy-gutter: ${tokens.layout.gutter}px;`);
  lines.push(`  --dy-sidebar: ${tokens.layout.sidebar}px;`);
  lines.push(`  --dy-rail: ${tokens.layout.rail}px;`);
  lines.push(`  --dy-toolbar: ${tokens.layout.toolbar}px;`);
  lines.push(`  --dy-tab: ${tokens.layout.tab}px;`);
  lines.push(`  --dy-spread: ${tokens.layout.spread}px;`);
  lines.push(`  --dy-phone: ${tokens.layout.phone}px;`);
  for (const [name, value] of Object.entries(tokens.layer)) {
    lines.push(`  --dy-layer-${name}: ${value};`);
  }
  lines.push(`  --dy-motion-fast: ${tokens.motion.fast}ms;`);
  lines.push(`  --dy-motion-base: ${tokens.motion.base}ms;`);
  lines.push(`  --dy-motion-ease: ${tokens.motion.ease};`);
  lines.push(`  --dy-notice-dwell: ${tokens.notice.dwell}ms;`);
  lines.push(`  --dy-wave-height: ${tokens.wave.height}px;`);
  lines.push(`  --dy-wave-bar: ${tokens.wave.bar}px;`);
  lines.push(`  --dy-wave-gap: ${tokens.wave.gap}px;`);
  lines.push(`  --dy-wave-min: ${tokens.wave.min}px;`);
  lines.push(`  --dy-wave-idle: ${tokens.wave.idle};`);
  lines.push(`  --dy-wave-played: ${tokens.wave.played};`);
  lines.push(`  --dy-state-bar: ${tokens.state.bar}px;`);
  lines.push(`  --dy-state-disabled: ${tokens.state.disabled};`);
  lines.push(`  --dy-font-sans: ${tokens.font.stack};`);
  lines.push(`  --dy-font-mono: ${tokens.font.monoStack};`);
  return lines.join('\n');
}

function typeClasses() {
  const reading = [
    '.dy-reading {',
    `  font-family: var(--dy-font-reading);`,
    `  font-size: var(--dy-reading-size);`,
    `  font-weight: var(--dy-reading-weight);`,
    `  line-height: var(--dy-reading-line-height);`,
    `  letter-spacing: 0;`,
    `  max-width: var(--dy-reading-measure);`,
    '}',
  ].join('\n');

  return `${TYPE_NAMES.map((name) => {
    const type = tokens.type[name];
    const lines = [
      `.dy-${name} {`,
      `  font-size: ${num(type.size)}px;`,
      `  font-weight: ${type.weight};`,
      `  line-height: ${type.lineHeight};`,
      `  letter-spacing: ${type.letterSpacing};`,
    ];
    if (type.uppercase) lines.push('  text-transform: uppercase;');
    if (name === 'mono' || type.mono) lines.push('  font-family: var(--dy-font-mono);');
    if (type.tabular) {
      lines.push('  font-variant-numeric: tabular-nums;');
      lines.push('  font-feature-settings: "tnum" 1;');
    }
    lines.push('}');
    return lines.join('\n');
  }).join('\n\n')}\n\n${reading}`;
}

function cssCore(urlBase) {
  return [
    fontFaces(urlBase),
    paletteBlock(':root', tokens.palettes.light),
    `@media (prefers-color-scheme: dark) {\n${indent(paletteBlock(':root', tokens.palettes.dark), '  ')}\n}`,
    THEMES.map((theme) => paletteBlock(`[data-dy-theme="${theme}"]`, tokens.palettes[theme])).join('\n\n'),
    `:root {\n${scaleBlock()}\n}`,
    typeClasses(),
  ].join('\n\n');
}

const HEADER =
  '/* Arquivo gerado por scripts/design-tokens.mjs a partir de docs/design/tokens.json.\n' +
  '   Nao edite a mao: rode `make tokens` para regerar. */';

const tokensCss = `${HEADER}\n\n${cssCore('/fonts')}\n`;

function designTs() {
  const colorLines = THEMES.map((theme) => {
    const palette = tokens.palettes[theme];
    const entries = PALETTE_KEYS.map((key) => {
      const camel = key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return `    ${camel}: '${palette[key]}',`;
    }).join('\n');
    return `  ${theme}: {\n${entries}\n  },`;
  }).join('\n');

  const typeLines = TYPE_NAMES.map((name) => {
    const type = tokens.type[name];
    return (
      `  ${name}: {\n` +
      `    size: ${num(type.size)},\n` +
      `    weight: ${type.weight},\n` +
      `    lineHeight: ${type.lineHeight},\n` +
      `    letterSpacing: ${letterSpacing(type.letterSpacing)},\n` +
      '  },'
    );
  }).join('\n');

  const spaceLines = tokens.space.map((value) => `  s${value}: ${value},`).join('\n');

  const fontRegular = tokens.font.mobile.medium.replace(/\.ttf$/, '');
  const fontSemibold = tokens.font.mobile.semibold.replace(/\.ttf$/, '');

  return `/**
 * Arquivo gerado por scripts/design-tokens.mjs a partir de docs/design/tokens.json.
 * Nao edite a mao: rode \`make tokens\` para regerar.
 */

export type DesignThemeName = '${THEMES.join("' | '")}';

export type DesignColors = {
${PALETTE_KEYS.map((key) => `  ${key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())}: string;`).join('\n')}
};

export const designColors: Record<DesignThemeName, DesignColors> = {
${colorLines}
};

export const designType = {
${typeLines}
} as const;

export const designSpace = {
${spaceLines}
} as const;

export const designRadius = {
  control: ${tokens.radius.control},
  surface: ${tokens.radius.surface},
} as const;

export const designFocus = {
  width: ${tokens.focus.width},
  offset: ${tokens.focus.offset},
} as const;

export const designControl = {
  sm: ${tokens.control.sm},
  md: ${tokens.control.md},
  lg: ${tokens.control.lg},
  padSm: ${tokens.control.padX.sm},
  padMd: ${tokens.control.padX.md},
  padLg: ${tokens.control.padX.lg},
} as const;

export const designMeter = {
  height: ${tokens.meter.height},
  gap: ${tokens.meter.gap},
  compose: ${tokens.meter.compose},
} as const;

export const designRow = {
  touch: ${tokens.row.touch},
  dense: ${tokens.row.dense},
} as const;

export const designTree = {
  cell: ${tokens.tree.cell},
  rail: ${tokens.tree.rail},
  guide: ${tokens.tree.guide},
} as const;

export const designMark = {
  size: ${tokens.mark.size},
  stroke: ${tokens.mark.stroke},
  tick: ${tokens.mark.tick},
} as const;

export const designChart = {
  height: ${tokens.chart.height},
  top: ${tokens.chart.top},
  base: ${tokens.chart.base},
  labels: ${tokens.chart.labels},
  barMin: ${tokens.chart.barMin},
  colMin: ${tokens.chart.colMin},
  colMax: ${tokens.chart.colMax},
  colRatio: ${tokens.chart.colRatio},
  sessionMin: ${tokens.chart.sessionMin},
  sessionBarMin: ${tokens.chart.sessionBarMin},
} as const;

export const designIcon = {
  sm: ${tokens.icon.sm},
  md: ${tokens.icon.md},
  lg: ${tokens.icon.lg},
  box: ${tokens.icon.box},
  stroke: ${tokens.icon.stroke},
  strokeDetail: ${tokens.icon.strokeDetail},
  set: ${JSON.stringify(Object.keys(icons.glyphs))},
} as const;

export const designReading = {
  family: '${tokens.reading.family}',
  stack: ${JSON.stringify(tokens.reading.stack)},
  size: ${tokens.reading.size},
  weight: ${tokens.reading.weight},
  lineHeight: ${tokens.reading.lineHeight},
  measure: ${tokens.reading.measure},
} as const;

export const designLayout = {
  page: ${tokens.layout.page},
  measure: ${tokens.layout.measure},
  gutter: ${tokens.layout.gutter},
  sidebar: ${tokens.layout.sidebar},
  rail: ${tokens.layout.rail},
  toolbar: ${tokens.layout.toolbar},
  tab: ${tokens.layout.tab},
  spread: ${tokens.layout.spread},
  phone: ${tokens.layout.phone},
} as const;

export const designLayer = {
${Object.entries(tokens.layer).map(([name, value]) => `  ${name}: ${value},`).join('\n')}
} as const;

export const designMotion = {
  fast: ${tokens.motion.fast},
  base: ${tokens.motion.base},
  ease: ${JSON.stringify(tokens.motion.ease)},
} as const;

export const designNotice = {
  dwell: ${tokens.notice.dwell},
} as const;

export const designWave = {
  height: ${tokens.wave.height},
  bar: ${tokens.wave.bar},
  gap: ${tokens.wave.gap},
  min: ${tokens.wave.min},
  idle: ${tokens.wave.idle},
  played: ${tokens.wave.played},
} as const;

export const designState = {
  bar: ${tokens.state.bar},
  disabled: ${tokens.state.disabled},
} as const;

export const designFont = {
  regular: '${fontRegular}',
  semibold: '${fontSemibold}',
  monoStack: ${JSON.stringify(tokens.font.monoStack)},
} as const;
`;
}

const STYLE_SAMPLE = indent(
  TYPE_NAMES.map(
    (name) => `  <div class="type-row">
    <span class="dy-${name}">${TYPE_SAMPLE[name]}</span>
    <span class="dy-mono meta">${TYPE_META[name]} · ${num(tokens.type[name].size)}</span>
  </div>`,
  ).join('\n'),
  '      ',
);

const SPACE_BARS = indent(
  tokens.space
    .map(
      (value) =>
        `  <div class="bar-row"><span class="dy-mono">${value}</span><span class="bar" style="width:var(--dy-space-${value})"></span></div>`,
    )
    .join('\n'),
  '      ',
);

const RADII = indent(
  [
    { key: 'control', value: tokens.radius.control },
    { key: 'surface', value: tokens.radius.surface },
  ]
    .map(
      ({ key, value }) => `  <div class="radius">
    <span class="sq r-${key}"></span>
    <span class="dy-mono">${value}</span>
  </div>`,
    )
    .join('\n'),
  '      ',
);

const ICONES = indent(
  [
    { label: 'maquina', d: '<rect x="1.75" y="2" width="12.5" height="4.75" rx="1.2"/><rect x="1.75" y="9.25" width="12.5" height="4.75" rx="1.2"/><path class="d" d="M4 4.4h2.2M4 11.6h2.2"/>' },
    { label: 'pasta', d: '<path d="M1.75 4.4c0-.9.72-1.6 1.6-1.6h2.9l1.7 1.9h4.7c.88 0 1.6.72 1.6 1.6v5.9c0 .88-.72 1.6-1.6 1.6H3.35c-.88 0-1.6-.72-1.6-1.6z"/>' },
    { label: 'sessao', d: '<path d="M3.25 1.75h6l3.5 3.5v9h-9.5z"/><path class="d" d="M9.4 1.9v3.2h3.2"/><path class="d" d="M5.5 8.3h4.9M5.5 10.9h3.2"/>' },
  ]
    .map(
      ({ label, d }) => `  <div class="ico">
    <svg viewBox="0 0 16 16" role="img" aria-label="${label}" stroke-linejoin="round">${d}</svg>
    <span class="dy-mono">${label}</span>
  </div>`,
    )
    .join('\n'),
  '    ',
);

const SWATCHES = indent(
  THEMES.map((theme) => {
    const palette = tokens.palettes[theme];
    const items = PALETTE_KEYS.map(
      (key) => `      <div class="swatch">
        <div class="chip" style="--c:var(--dy-${key})"></div>
        <span class="dy-mono">${key}</span>
        <span class="dy-mono hex">${palette[key]}</span>
      </div>`,
    ).join('\n');
    return `  <div class="group" data-dy-theme="${theme}">
    <h3 class="dy-label dy-muted">${THEME_LABEL[theme]}</h3>
    <div class="swatches">
${items}
    </div>
  </div>`;
  }).join('\n'),
  '    ',
);

const BUTTON_HEAD = BUTTON_SIZES.map(
  (size) => `<span class="dy-label">${size} · ${tokens.control[size]}</span>`,
).join('\n        ');

const BUTTON_VARIANTS_HTML = BUTTON_VARIANTS.map(({ key, label, text }) => {
  const rows = BUTTON_STATES.map((state) => {
    const cells = BUTTON_SIZES.map(
      (size) =>
        `          <span class="cell"><button class="dy-btn dy-label dy-btn--${key} dy-btn--${size}${state.cls}" type="button"${
          state.disabled ? ' disabled' : ''
        }>${text}</button></span>`,
    ).join('\n');
    return `        <div class="btn-row">
          <span class="dy-label state">${state.label}</span>
${cells}
        </div>`;
  }).join('\n');
  return `      <div class="variant">
        <h3 class="dy-label">${label}</h3>
${rows}
      </div>`;
}).join('\n');

const READING_HTML = `      <p class="dy-reading reading-note">O primeiro registro veio de uma caminhada, sem intenção de virar capítulo. A ideia era só guardar o que não podia ser dito em voz alta naquele dia.</p>
      <span class="dy-mono reading-meta">${tokens.reading.family} · ${tokens.reading.size}/${tokens.reading.lineHeight} · ${tokens.reading.measure}ch</span>`;

function waveBars(count, played) {
  let seed = 41;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const bars = [];
  for (let index = 0; index < count; index += 1) {
    const envelope = 0.4 + 0.6 * Math.sin((index / count) * Math.PI);
    const height = Math.max(tokens.wave.min, Math.round((2 + next() * 38) * envelope));
    const playedClass = index / count < played ? ' class="played"' : '';
    bars.push(`        <b${playedClass} style="height:${height}px"></b>`);
  }
  return bars.join('\n');
}

const WAVE_HTML = `      <div class="wave" role="img" aria-label="onda do áudio, parte tocada em primária">
${waveBars(96, 0.38)}
      </div>
      <span class="dy-mono reading-meta">barra ${tokens.wave.bar} · vão ${tokens.wave.gap} · altura ${tokens.wave.height} · ociosa ${tokens.wave.idle}</span>`;

const ICONS_HTML = indent(
  Object.entries(icons.glyphs)
    .map(
      ([name, glyph]) => `  <div class="glyph">
    <svg viewBox="0 0 ${icons.viewBox} ${icons.viewBox}" role="img" aria-label="${name}"><path d="${glyph.d}"${glyph.fill ? ' fill="currentColor" stroke="none"' : ''}/></svg>
    <span class="dy-mono">${name}</span>
  </div>`,
    )
    .join('\n'),
  '      ',
);

const LAYERS_HTML = indent(
  Object.entries(tokens.layer)
    .map(
      ([name, value]) =>
        `  <div class="row"><span class="dy-mono">${name}</span><span class="step" style="width:${Math.max(8, value * 2)}px"></span><span class="dy-mono">${value}</span></div>`,
    )
    .join('\n'),
  '      ',
);

const START_HTML = `      <div class="start">
        <h3 class="dy-greeting">Bom dia</h3>
        <p class="summary dy-body">34 notas neste mês, 18% mais que no anterior. Você escreveu em 22 dias e está há 5 dias seguidos.</p>
        <div class="facts">
          <span class="dy-mono">palavra</span><span class="dy-body value">reunião</span>
          <span class="dy-mono">assunto</span><span class="dy-body value">entrega</span>
          <span class="dy-mono">24.180</span><span class="dy-mono">palavras</span>
        </div>
        <div class="acts">
          <button class="dy-btn dy-label dy-btn--primary dy-btn--lg" type="button">nova nota</button>
          <button class="dy-btn dy-label dy-btn--secondary dy-btn--lg" type="button">análise</button>
        </div>
      </div>`;

const GALLERY_LAYOUT_CSS = `*{box-sizing:border-box}
html{background:var(--dy-surface)}
body{
  margin:0;
  background:var(--dy-surface);
  color:var(--dy-text);
  font-family:var(--dy-font-sans);
  -webkit-font-smoothing:antialiased;
  text-rendering:optimizeLegibility;
}
h2,h3,p,ul,figure{margin:0}
button{font:inherit}

.wrap{width:100%;max-width:680px;margin:0 auto;padding:0 var(--dy-space-16)}
main{display:block;padding:var(--dy-space-16) 0 0}

section{padding:var(--dy-space-12) 0}
section + section{border-top:1px solid var(--dy-line)}
.wrap > section:first-child{padding-top:0}
section > .dy-label{margin:0 0 var(--dy-space-6)}

.dy-muted{color:var(--dy-text-muted)}

/* 1. cores */
.group + .group{margin-top:var(--dy-space-8)}
.group > .dy-label{margin:0 0 var(--dy-space-4)}
.swatches{
  display:grid;
  grid-template-columns:repeat(auto-fill,minmax(120px,1fr));
  gap:var(--dy-space-8) var(--dy-space-6);
}
.swatch{min-width:0}
.chip{
  height:var(--dy-control-md);
  background:var(--c);
  border:1px solid var(--dy-line);
  border-radius:var(--dy-radius-control);
  margin-bottom:var(--dy-space-2);
}
.swatch .dy-mono{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.swatch .hex{color:var(--dy-text-muted);margin-top:var(--dy-space-2)}

/* 2. tipografia */
.types{display:block}
.type-row{
  display:grid;
  grid-template-columns:minmax(0,1fr) auto;
  align-items:baseline;
  gap:var(--dy-space-16);
  padding:var(--dy-space-4) 0;
  border-top:1px solid var(--dy-line);
}
.type-row:first-child{border-top:0;padding-top:0}
.type-row:last-child{padding-bottom:0}
.type-row .meta{color:var(--dy-text-muted);white-space:nowrap}

/* 3. espaço e raio */
.bars{display:grid;gap:var(--dy-space-4)}
.bar-row{display:flex;align-items:center;gap:var(--dy-space-8)}
.bar-row .dy-mono{width:calc(var(--dy-space-16) + var(--dy-space-6));text-align:right;color:var(--dy-text-muted)}
.bar{
  height:var(--dy-space-8);
  flex:none;
  background:var(--dy-surface-raised);
  border:1px solid var(--dy-line);
}
.radii{
  display:flex;
  gap:var(--dy-space-8);
  margin-top:var(--dy-space-8);
  padding-top:var(--dy-space-8);
  border-top:1px solid var(--dy-line);
}
.radius{display:flex;flex-direction:column;gap:var(--dy-space-6)}
.radius .dy-mono{color:var(--dy-text-muted)}
.sq{
  width:calc(var(--dy-control-lg) - var(--dy-radius-control));
  height:calc(var(--dy-control-lg) - var(--dy-radius-control));
  background:var(--dy-surface-alt);
  border:1px solid var(--dy-line);
}
.r-control{border-radius:var(--dy-radius-control)}
.r-surface{border-radius:var(--dy-radius-surface)}

/* icones: escala e traco vem dos tokens */
.icones{
  display:flex;
  gap:var(--dy-space-16);
  margin-top:var(--dy-space-8);
  padding-top:var(--dy-space-8);
  border-top:1px solid var(--dy-line);
}
.ico{display:flex;flex-direction:column;align-items:flex-start;gap:var(--dy-space-4)}
.ico svg{
  width:var(--dy-icon-md);
  height:var(--dy-icon-md);
  fill:none;
  stroke:currentColor;
  stroke-width:var(--dy-icon-stroke);
  color:var(--dy-text);
}
.ico svg .d{stroke-width:var(--dy-icon-stroke-detail);stroke-linecap:round}
.ico .dy-mono{color:var(--dy-text-muted)}

/* 4. botões */
.btn-head,
.btn-row{
  display:grid;
  grid-template-columns:94px repeat(3,minmax(0,1fr));
  column-gap:var(--dy-space-12);
}
.btn-head{padding-bottom:var(--dy-space-4)}
.btn-head .dy-label,
.btn-row .state{color:var(--dy-text-muted)}
.variant{margin-top:var(--dy-space-8);padding-top:var(--dy-space-6);border-top:1px solid var(--dy-line)}
.btn-head + .variant{margin-top:var(--dy-space-12);padding-top:0;border-top:0}
.variant > .dy-label{margin:0 0 var(--dy-space-2);color:var(--dy-text-muted)}
.btn-row{min-height:var(--dy-control-lg);align-items:center}
.btn-row .cell{display:flex;align-items:center;min-width:0}

.dy-btn{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  max-width:100%;
  border:1px solid transparent;
  border-radius:var(--dy-radius-control);
  white-space:nowrap;
  cursor:pointer;
  appearance:none;
  -webkit-appearance:none;
}
.dy-btn--sm{height:var(--dy-control-sm);padding:0 var(--dy-control-pad-sm)}
.dy-btn--md{height:var(--dy-control-md);padding:0 var(--dy-control-pad-md)}
.dy-btn--lg{height:var(--dy-control-lg);padding:0 var(--dy-control-pad-lg)}
.dy-btn:disabled{cursor:not-allowed}

.dy-btn--primary{background:var(--dy-primary);border-color:var(--dy-primary);color:var(--dy-surface)}
.dy-btn--primary.is-hover{background:var(--dy-primary-soft);border-color:var(--dy-primary);color:var(--dy-text)}
.dy-btn--primary:disabled{background:var(--dy-primary-soft);border-color:var(--dy-line);color:var(--dy-text-muted)}

.dy-btn--secondary{background:var(--dy-surface-alt);border-color:var(--dy-line);color:var(--dy-text)}
.dy-btn--secondary.is-hover{background:var(--dy-surface-raised);border-color:var(--dy-line);color:var(--dy-text)}
.dy-btn--secondary:disabled{background:var(--dy-surface);border-color:var(--dy-line);color:var(--dy-text-muted)}

.dy-btn--ghost{background:transparent;border-color:transparent;color:var(--dy-text)}
.dy-btn--ghost.is-hover{background:var(--dy-surface-alt);border-color:transparent;color:var(--dy-text)}
.dy-btn--ghost:disabled{background:transparent;border-color:transparent;color:var(--dy-text-muted)}

.dy-btn.is-focus{outline:var(--dy-focus-width) solid var(--dy-primary);outline-offset:var(--dy-focus-offset)}
.dy-btn:focus-visible{outline:var(--dy-focus-width) solid var(--dy-primary);outline-offset:var(--dy-focus-offset)}

/* 5. campos */
.fields{display:grid;grid-template-columns:1fr 1fr;gap:var(--dy-space-8) var(--dy-space-12)}
.field{display:flex;flex-direction:column;gap:var(--dy-space-2);min-width:0}
.field > .dy-label{color:var(--dy-text-muted)}
.input{
  display:flex;
  align-items:center;
  width:100%;
  height:var(--dy-control-md);
  padding:0 var(--dy-control-pad-md);
  background:var(--dy-surface-alt);
  border:1px solid var(--dy-line);
  border-radius:var(--dy-radius-control);
  color:var(--dy-text);
}
.input .value{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.input.is-focus{outline:var(--dy-focus-width) solid var(--dy-primary);outline-offset:var(--dy-focus-offset)}
.caret{
  width:var(--dy-focus-width);
  height:var(--dy-space-12);
  background:var(--dy-primary);
  margin-left:var(--dy-space-2);
  flex:none;
}
.select{justify-content:space-between;gap:var(--dy-space-8)}
.select svg{flex:none;color:var(--dy-text-muted)}
.switch-row{display:flex;align-items:center;gap:var(--dy-space-12);height:var(--dy-control-md)}
.switch-item{display:inline-flex;align-items:center;gap:var(--dy-space-8)}
.switch{
  position:relative;
  width:calc(var(--dy-space-16) + var(--dy-space-12));
  height:calc(var(--dy-space-16) - var(--dy-focus-width));
  flex:none;
  background:var(--dy-surface-raised);
  border:1px solid var(--dy-line);
  border-radius:var(--dy-radius-control);
}
.switch::after{
  content:"";
  position:absolute;
  top:var(--dy-space-2);
  left:var(--dy-space-2);
  width:calc(var(--dy-space-8) + var(--dy-focus-width));
  height:calc(var(--dy-space-8) + var(--dy-focus-width));
  background:var(--dy-text-muted);
  border-radius:var(--dy-focus-width);
}
.switch.is-on{background:var(--dy-primary);border-color:var(--dy-primary)}
.switch.is-on::after{left:auto;right:var(--dy-space-2);background:var(--dy-surface)}

/* 6. medidores */
.meter{display:flex;align-items:center;gap:var(--dy-meter-gap)}
.track{flex:1;height:var(--dy-meter-height);background:var(--dy-line)}
.fill{height:var(--dy-meter-height);background:var(--dy-primary)}
.meter .dy-mono{flex:none}
.note-states{
  display:flex;
  flex-wrap:wrap;
  gap:var(--dy-space-12);
  margin-top:var(--dy-space-8);
  padding-top:var(--dy-space-8);
  border-top:1px solid var(--dy-line);
}
.note-state{display:flex;flex-direction:column;gap:var(--dy-space-4);min-width:64px}
.note-state .dy-label{color:var(--dy-text-muted)}
.state-glyph{display:inline-flex;width:var(--dy-space-16);height:var(--dy-space-16);flex:none}
.state-glyph svg{display:block;width:var(--dy-space-16);height:var(--dy-space-16)}
.state-glyph.done svg{fill:var(--dy-success)}
.state-glyph.todo svg{fill:none;stroke:var(--dy-text-muted);stroke-width:1.5}
.state-glyph.out svg{fill:none;stroke:var(--dy-warning);stroke-width:1.5}

/* 7. notas */
.notes{
  list-style:none;
  padding:0;
  background:var(--dy-surface-alt);
  border:1px solid var(--dy-line);
  border-radius:var(--dy-radius-surface);
  overflow:hidden;
}
.note{
  display:flex;
  align-items:center;
  gap:var(--dy-space-8);
  min-height:var(--dy-control-md);
  padding:0 var(--dy-space-8);
}
.note + .note{border-top:1px solid var(--dy-line)}
.note .note-name{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.note .date{margin-left:auto;padding-left:var(--dy-space-8);color:var(--dy-text-muted);white-space:nowrap}

/* 8. notificação */
.notif{
  display:flex;
  align-items:center;
  gap:var(--dy-space-8);
  width:100%;
  max-width:380px;
  padding:var(--dy-space-6) var(--dy-control-pad-md);
  background:var(--dy-surface-raised);
  border:1px solid var(--dy-line);
  border-radius:var(--dy-radius-surface);
}
.notif-num{font-variant-numeric:tabular-nums}
.notif-rule{width:var(--dy-focus-width);height:var(--dy-space-12);flex:none;background:var(--dy-line)}
.notif-name{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* 9. leitura */
.reading-note{color:var(--dy-text)}
.reading-meta{display:block;margin-top:var(--dy-space-8);color:var(--dy-text-muted)}

/* 10. onda */
.wave{
  display:flex;
  align-items:center;
  gap:var(--dy-wave-gap);
  height:var(--dy-wave-height);
  margin-top:var(--dy-space-8);
}
.wave b{
  flex:1;
  min-width:var(--dy-wave-bar);
  background:var(--dy-text);
  opacity:var(--dy-wave-idle);
  border-radius:0.5px;
}
.wave b.played{background:var(--dy-primary);opacity:var(--dy-wave-played)}

/* 11. icones */
.set{
  display:grid;
  grid-template-columns:repeat(auto-fill,minmax(64px,1fr));
  gap:var(--dy-space-4);
  margin-top:var(--dy-space-8);
}
.set .glyph{
  display:flex;
  flex-direction:column;
  align-items:center;
  gap:var(--dy-space-4);
  padding:var(--dy-space-8) 0;
  background:var(--dy-surface-alt);
  border:1px solid var(--dy-line);
  border-radius:var(--dy-radius-surface);
}
.set svg{
  width:var(--dy-icon-box);
  height:var(--dy-icon-box);
  fill:none;
  stroke:currentColor;
  stroke-width:var(--dy-icon-stroke);
  stroke-linecap:square;
  stroke-linejoin:miter;
  color:var(--dy-text);
}
.set .dy-mono{color:var(--dy-text-muted);font-size:9px}

/* 12. camadas */
.layers{display:grid;gap:var(--dy-space-2);margin-top:var(--dy-space-4)}
.layers .row{display:flex;align-items:center;gap:var(--dy-space-8)}
.layers .row .dy-mono:first-child{width:calc(var(--dy-space-16) * 3);color:var(--dy-text-muted)}
.layers .step{height:var(--dy-space-8);background:var(--dy-surface-raised);border:1px solid var(--dy-line)}

/* 13. inicio */
.start{
  margin-top:var(--dy-space-8);
  padding:var(--dy-space-24) var(--dy-space-16);
  background:var(--dy-surface-alt);
  border:1px solid var(--dy-line);
  border-radius:var(--dy-radius-surface);
  text-align:center;
}
.start .dy-greeting{margin:0 0 var(--dy-space-8)}
.start .summary{
  margin:0 auto var(--dy-space-12);
  max-width:38ch;
  color:var(--dy-text-muted);
}
.start .facts{
  display:flex;
  flex-wrap:wrap;
  justify-content:center;
  gap:var(--dy-space-8);
  padding:var(--dy-space-8) 0;
  border-top:1px solid var(--dy-line);
  border-bottom:1px solid var(--dy-line);
  margin-bottom:var(--dy-space-12);
}
.start .value{font-weight:600}
.start .acts{display:flex;justify-content:center;gap:var(--dy-space-6);flex-wrap:wrap}

/* 14. contraexemplo */
.forbidden{
  padding:var(--dy-control-pad-md);
  background:var(--dy-surface-alt);
  border:1px solid var(--dy-line);
  border-radius:var(--dy-radius-surface);
}
.forbidden-head{display:flex;align-items:center;gap:var(--dy-space-8);color:var(--dy-danger)}
.forbidden-head svg{flex:none}
.forbidden-head .dy-label{color:var(--dy-text)}
.forbidden-text{
  margin-top:var(--dy-space-4);
  color:var(--dy-text-muted);
  text-decoration:line-through;
  text-decoration-thickness:1px;
  text-decoration-color:var(--dy-danger);
  text-decoration-skip-ink:none;
}

@media (max-width:480px){
  .btn-head,
  .btn-row{grid-template-columns:repeat(3,minmax(0,1fr))}
  .btn-head .spacer{display:none}
  .btn-row{row-gap:var(--dy-space-6);padding:var(--dy-space-8) 0;border-top:1px solid var(--dy-line)}
  .btn-row .state{grid-column:1 / -1}
  .dy-btn--sm,.dy-btn--md,.dy-btn--lg{padding-left:var(--dy-space-6);padding-right:var(--dy-space-6)}
}

@media (max-width:560px){
  .fields{grid-template-columns:1fr}
}`;

const GALLERY = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
${HEADER}

${cssCore('./fonts')}

${GALLERY_LAYOUT_CSS}
</style>
</head>
<body class="dy-body">

<main>
  <div class="wrap">

    <!-- 1. cores -->
    <section>
      <h2 class="dy-label dy-muted">cores</h2>
${SWATCHES}
    </section>

    <!-- 2. tipografia -->
    <section>
      <h2 class="dy-label dy-muted">tipografia</h2>
      <div class="types">
${STYLE_SAMPLE}
      </div>
    </section>

    <!-- 3. espaço e raio -->
    <section>
      <h2 class="dy-label dy-muted">espaço e raio</h2>
      <div class="bars">
${SPACE_BARS}
      </div>
      <div class="radii">
${RADII}
      </div>
      <div class="icones">
${ICONES}
      </div>
    </section>

    <!-- 4. botões -->
    <section>
      <h2 class="dy-label dy-muted">botões</h2>

      <div class="btn-head">
        <span class="spacer"></span>
        ${BUTTON_HEAD}
      </div>

${BUTTON_VARIANTS_HTML}
    </section>

    <!-- 5. campos -->
    <section>
      <h2 class="dy-label dy-muted">campos</h2>
      <div class="fields">
        <div class="field">
          <span class="dy-label">nota</span>
          <div class="input"><span class="dy-body value">Consulta médica</span></div>
        </div>
        <div class="field">
          <span class="dy-label">nota</span>
          <div class="input is-focus"><span class="dy-body value">Consulta médica</span><span class="caret"></span></div>
        </div>
        <div class="field">
          <span class="dy-label">coleção</span>
          <div class="input select">
            <span class="dy-body value">Saúde</span>
            <svg width="9" height="6" viewBox="0 0 9 6" aria-hidden="true"><path d="M1 1l3.5 3.5L8 1" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
          </div>
        </div>
        <div class="field">
          <span class="dy-label">sincronizar</span>
          <div class="switch-row">
            <span class="switch-item"><span class="switch" aria-hidden="true"></span><span class="dy-label">desligado</span></span>
            <span class="switch-item"><span class="switch is-on" aria-hidden="true"></span><span class="dy-label">ligado</span></span>
          </div>
        </div>
      </div>
    </section>

    <!-- 6. medidores -->
    <section>
      <h2 class="dy-label dy-muted">medidores</h2>
      <div class="meter">
        <div class="track"><div class="fill" style="width:64%"></div></div>
        <span class="dy-mono">18/28</span>
      </div>
      <div class="note-states">
        <div class="note-state">
          <span class="state-glyph done" role="img" aria-label="feito">
            <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6"/></svg>
          </span>
          <span class="dy-label">feito</span>
        </div>
        <div class="note-state">
          <span class="state-glyph todo" role="img" aria-label="não feito">
            <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/></svg>
          </span>
          <span class="dy-label">não feito</span>
        </div>
        <div class="note-state">
          <span class="state-glyph out" role="img" aria-label="ficou de fora">
            <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M4 8h8"/></svg>
          </span>
          <span class="dy-label">ficou de fora</span>
        </div>
      </div>
    </section>

    <!-- 7. notas -->
    <section>
      <h2 class="dy-label dy-muted">notas</h2>
      <ul class="notes">
        <li class="note">
          <span class="state-glyph done" role="img" aria-label="feito">
            <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6"/></svg>
          </span>
          <span class="dy-body note-name">Reunião com fornecedor</span>
          <span class="dy-mono date">12 mar</span>
        </li>
        <li class="note">
          <span class="state-glyph todo" role="img" aria-label="não feito">
            <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/></svg>
          </span>
          <span class="dy-body note-name">Ideia de captura offline</span>
          <span class="dy-mono date">9 mar</span>
        </li>
        <li class="note">
          <span class="state-glyph out" role="img" aria-label="ficou de fora">
            <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M4 8h8"/></svg>
          </span>
          <span class="dy-body note-name">Consulta médica</span>
          <span class="dy-mono date">4 mar</span>
        </li>
      </ul>
    </section>

    <!-- 8. notificação -->
    <section>
      <h2 class="dy-label dy-muted">notificação</h2>
      <div class="notif">
        <span class="dy-title notif-num">3</span>
        <span class="notif-rule"></span>
        <span class="dy-body notif-name">Reunião com fornecedor</span>
      </div>
    </section>

    <!-- 9. leitura -->
    <section>
      <h2 class="dy-label dy-muted">leitura</h2>
${READING_HTML}
    </section>

    <!-- 10. onda -->
    <section>
      <h2 class="dy-label dy-muted">onda</h2>
${WAVE_HTML}
    </section>

    <!-- 11. ícones -->
    <section>
      <h2 class="dy-label dy-muted">ícones</h2>
      <div class="set">
${ICONS_HTML}
      </div>
    </section>

    <!-- 12. camadas -->
    <section>
      <h2 class="dy-label dy-muted">camadas</h2>
      <div class="layers">
${LAYERS_HTML}
      </div>
    </section>

    <!-- 13. início -->
    <section>
      <h2 class="dy-label dy-muted">início</h2>
${START_HTML}
    </section>

    <!-- 14. contraexemplo -->
    <section>
      <h2 class="dy-label dy-muted">contraexemplo</h2>
      <div class="forbidden">
        <div class="forbidden-head">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
          <span class="dy-label">proibido</span>
        </div>
        <p class="dy-body forbidden-text">Suas ideias ficam organizadas automaticamente, seguras e sempre sincronizadas entre os aparelhos.</p>
      </div>
    </section>

  </div>
</main>

</body>
</html>
`;

function iconGlyphsTs() {
  const entries = Object.entries(icons.glyphs)
    .map(([name, glyph]) => {
      const lines = [
        `  ${/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name)}: {`,
        `    d: ${JSON.stringify(glyph.d)},`,
        `    fill: ${glyph.fill ? 'true' : 'false'},`,
        '  },',
      ];
      return lines.join('\n');
    })
    .join('\n');
  const names = Object.keys(icons.glyphs)
    .map((name) => `  '${name}',`)
    .join('\n');

  return `${HEADER}

export const iconViewBox = ${icons.viewBox};

export const iconGlyphs = {
${entries}
} as const;

export type IconName = keyof typeof iconGlyphs;

export const iconNames = [
${names}
] as const;
`;
}

const OUTPUTS = [
  { path: 'web/src/ui/tokens.css', body: tokensCss },
  { path: 'web/src/ui/iconGlyphs.ts', body: iconGlyphsTs() },
  { path: 'mobile/src/theme/design.ts', body: designTs() },
  { path: 'docs/design/index.html', body: GALLERY },
];

function firstDivergence(expected, actual) {
  const wanted = expected.split('\n');
  const found = actual.split('\n');
  const total = Math.max(wanted.length, found.length);
  for (let index = 0; index < total; index += 1) {
    if (wanted[index] !== found[index]) {
      return { line: index + 1, expected: wanted[index], actual: found[index] };
    }
  }
  return null;
}

if (checkOnly) {
  let drifted = 0;
  for (const output of OUTPUTS) {
    let actual;
    try {
      actual = readFileSync(join(root, output.path), 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      actual = null;
    }

    if (actual === output.body) continue;

    drifted += 1;
    if (actual === null) {
      process.stdout.write(`${output.path}: arquivo ausente\n`);
      continue;
    }

    const diff = firstDivergence(output.body, actual);
    process.stdout.write(`${output.path}: linha ${diff.line} divergente\n`);
    process.stdout.write(`  esperado: ${JSON.stringify(diff.expected ?? '')}\n`);
    process.stdout.write(`  atual:    ${JSON.stringify(diff.actual ?? '')}\n`);
  }

  if (drifted > 0) {
    process.stdout.write(`\n${drifted} arquivo(s) fora de sincronia. Rode \`make tokens\`.\n`);
    process.exit(1);
  }

  process.stdout.write(`tokens em sincronia: ${OUTPUTS.length} arquivos\n`);
  process.exit(0);
}

for (const output of OUTPUTS) {
  const target = join(root, output.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, output.body, 'utf8');
  process.stdout.write(`gerado ${output.path}\n`);
}
