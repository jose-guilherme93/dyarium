import { createThemedStyles } from '../themedStyles';
import { THEMES, colors, gradients, normalizeTheme, setActiveTheme } from '../tokens';

describe('normalizeTheme', () => {
  it('aceita os tres temas e cai no AMOLED para valor desconhecido', () => {
    expect(normalizeTheme('light')).toBe('light');
    expect(normalizeTheme('dark')).toBe('dark');
    expect(normalizeTheme('amoled')).toBe('amoled');
    expect(normalizeTheme('sepia')).toBe('amoled');
    expect(normalizeTheme(undefined)).toBe('amoled');
  });
});

describe('createThemedStyles', () => {
  afterEach(() => setActiveTheme('amoled'));

  const styles = createThemedStyles({
    card: {
      backgroundColor: '#000000',
      borderColor: 'rgba(255,255,255,0.18)',
      color: '#FFFFFF',
    },
    onAccent: { color: 'rgb(255, 255, 255)' },
    shadow: { shadowColor: '#000000' },
    fixed: { backgroundColor: 'transparent' },
  });

  it('troca as cores da paleta base pela paleta ativa', () => {
    setActiveTheme('light');
    expect(styles.card.backgroundColor).toBe(THEMES.light.colors.bg);
    expect(styles.card.borderColor).toBe(THEMES.light.colors.borderStrong);
    expect(styles.card.color).toBe(THEMES.light.colors.text);
    expect(styles.onAccent.color).toBe(THEMES.light.colors.onAccent);
    // Sombra e cores fora da paleta nao sao tocadas.
    expect(styles.shadow.shadowColor).toBe('#000000');
    expect(styles.fixed.backgroundColor).toBe('transparent');
  });

  it('devolve a mesma variante enquanto o tema nao muda', () => {
    setActiveTheme('dark');
    const first = styles.card;
    expect(styles.card).toBe(first);
    setActiveTheme('amoled');
    expect(styles.card).not.toBe(first);
  });

  it('usa a paleta AMOLED por padrao', () => {
    expect(styles.card.backgroundColor).toBe(THEMES.amoled.colors.bg);
    expect(styles.card.color).toBe(THEMES.amoled.colors.text);
  });

  it('os leitores devolvem a paleta e os gradientes ativos', () => {
    setActiveTheme('dark');
    expect(colors.bg).toBe(THEMES.dark.colors.bg);
    expect(gradients.app).toEqual(THEMES.dark.gradients.app);
  });
});
