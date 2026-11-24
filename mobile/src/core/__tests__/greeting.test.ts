import { greetingForHour } from '../greeting';

describe('greetingForHour', () => {
  it('cumprimenta pela manha entre 5 e 11', () => {
    expect(greetingForHour(5)).toBe('Bom dia');
    expect(greetingForHour(9)).toBe('Bom dia');
    expect(greetingForHour(11)).toBe('Bom dia');
  });

  it('cumprimenta pela tarde entre 12 e 17', () => {
    expect(greetingForHour(12)).toBe('Boa tarde');
    expect(greetingForHour(15)).toBe('Boa tarde');
    expect(greetingForHour(17)).toBe('Boa tarde');
  });

  it('cumprimenta pela noite das 18 as 4', () => {
    expect(greetingForHour(18)).toBe('Boa noite');
    expect(greetingForHour(23)).toBe('Boa noite');
    expect(greetingForHour(0)).toBe('Boa noite');
    expect(greetingForHour(4)).toBe('Boa noite');
  });

  it('normaliza hora fora da faixa em vez de quebrar a tela', () => {
    expect(greetingForHour(24)).toBe('Boa noite');
    expect(greetingForHour(29)).toBe('Bom dia');
    expect(greetingForHour(-1)).toBe('Boa noite');
    expect(greetingForHour(4.9)).toBe('Boa noite');
  });
});
