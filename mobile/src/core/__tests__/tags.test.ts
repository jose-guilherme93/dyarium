import { TAG_PALETTE, tagColor, withAlpha } from '../tags';

describe('tagColor', () => {
  it('e estavel e ignora caixa e espacos', () => {
    expect(tagColor('Viagem')).toBe(tagColor('  viagem '));
  });

  it('bate com a paleta do servidor para nomes conhecidos', () => {
    expect(tagColor('familia')).toBe('#F2C4C4');
    expect(tagColor('viagem')).toBe('#EFE3A8');
  });

  it('sempre devolve uma cor da paleta', () => {
    for (const name of ['viagem', 'familia', 'trabalho', 'estudo', 'inglês', '']) {
      expect(TAG_PALETTE).toContain(tagColor(name));
    }
  });

  it('a cor vinda do servidor vence', () => {
    expect(tagColor('viagem', '#123456')).toBe('#123456');
  });
});

describe('withAlpha', () => {
  it('converte hex em rgba', () => {
    expect(withAlpha('#F2C4C4', 0.5)).toBe('rgba(242,196,196,0.5)');
    expect(withAlpha('#fff', 1)).toBe('rgba(255,255,255,1)');
  });
});
