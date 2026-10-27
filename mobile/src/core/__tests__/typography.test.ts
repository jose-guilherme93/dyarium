import {
  DEFAULT_TYPOGRAPHY,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  NOTE_LETTER_SPACING,
  clampFontSize,
  fontFamilyCss,
  fontFamilyNative,
  fontWeightCss,
  fontWeightNative,
  noteLineHeight,
  normalizeTypography,
} from '../typography';

describe('clampFontSize', () => {
  it('mantem dentro do intervalo', () => {
    expect(clampFontSize(17)).toBe(17);
    expect(clampFontSize(1)).toBe(MIN_FONT_SIZE);
    expect(clampFontSize(999)).toBe(MAX_FONT_SIZE);
  });

  it('usa o padrao com valor invalido', () => {
    expect(clampFontSize(NaN)).toBe(DEFAULT_TYPOGRAPHY.size);
  });
});

describe('normalizeTypography', () => {
  it('usa o padrao sem entrada', () => {
    expect(normalizeTypography(undefined)).toEqual(DEFAULT_TYPOGRAPHY);
    expect(DEFAULT_TYPOGRAPHY.size).toBe(16);
  });

  it('aceita valores validos', () => {
    expect(normalizeTypography({ family: 'serif', size: 20, weight: 'bold' })).toEqual({
      family: 'serif',
      size: 20,
      weight: 'bold',
    });
  });

  it('descarta valores invalidos', () => {
    expect(
      normalizeTypography({
        family: 'comic' as never,
        size: 200,
        weight: 'heavy' as never,
      }),
    ).toEqual({ family: 'system', size: MAX_FONT_SIZE, weight: 'regular' });
  });
});

describe('css', () => {
  it('mapeia familia e peso', () => {
    expect(fontFamilyCss('mono')).toContain('monospace');
    expect(fontFamilyCss('system')).toContain('sans-serif');
    expect(fontWeightCss('light')).toBe(300);
    expect(fontWeightCss('bold')).toBe(700);
  });
});

describe('nativo', () => {
  it('mapeia a familia para o React Native', () => {
    expect(fontFamilyNative('system')).toBe('Inter_400Regular');
    expect(fontFamilyNative('system', 'bold')).toBe('Inter_700Bold');
    expect(fontFamilyNative('serif')).toBe('serif');
    expect(fontFamilyNative('mono')).toBe('monospace');
  });

  it('mapeia o peso para o React Native', () => {
    expect(fontWeightNative('light')).toBe('300');
    expect(fontWeightNative('regular')).toBe('400');
    expect(fontWeightNative('bold')).toBe('700');
  });

  it('usa entrelinha e espacamento de leitura do Notion', () => {
    expect(noteLineHeight(16)).toBe(26);
    expect(noteLineHeight(20)).toBe(32);
    expect(NOTE_LETTER_SPACING).toBe(0.1);
  });
});
