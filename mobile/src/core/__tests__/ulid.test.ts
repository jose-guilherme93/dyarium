import { newUlid } from '../ulid';

describe('newUlid', () => {
  it('tem 26 caracteres do alfabeto Crockford', () => {
    const id = newUlid(new Date(1700000000000), () => 0);
    expect(id).toHaveLength(26);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('ordena cronologicamente (id cresce com o tempo)', () => {
    const before = newUlid(new Date(1700000000000), () => 0.5);
    const after = newUlid(new Date(1700000001000), () => 0.5);
    expect(before < after).toBe(true);
  });

  it('e deterministico para o mesmo tempo e aleatorio', () => {
    const a = newUlid(new Date(1700000000000), () => 0.1);
    const b = newUlid(new Date(1700000000000), () => 0.1);
    expect(a).toBe(b);
  });

  it('nao colide para tempos iguais com aleatorio diferente', () => {
    const a = newUlid(new Date(1700000000000), () => 0.1);
    const b = newUlid(new Date(1700000000000), () => 0.9);
    expect(a).not.toBe(b);
    // o prefixo de tempo e o mesmo; o sufixo aleatorio difere
    expect(a.slice(0, 10)).toBe(b.slice(0, 10));
  });
});
