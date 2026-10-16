import {
  DEFAULT_TYPOGRAPHY,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  clampFontSize,
  fontFamilyCss,
  fontWeightCss,
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
