import {
  compareHlc,
  formatHlc,
  nextHlc,
  observeHlc,
  parseHlc,
  versionAfter,
  versionTime,
} from '../hlc';

const AT = Date.UTC(2026, 9, 30, 12, 0, 0);

describe('hlc', () => {
  it('formata no mesmo formato do servidor', () => {
    expect(formatHlc({ physical: AT, counter: 7, node: 'dev_a' })).toBe(
      '001793361600000-000007-dev_a',
    );
  });

  it('faz round-trip', () => {
    const stamp = { physical: AT, counter: 42, node: 'instancia' };
    expect(parseHlc(formatHlc(stamp))).toEqual(stamp);
  });

  it('le a versao antiga em RFC3339 como stamp sem contador', () => {
    const parsed = parseHlc('2026-10-30T12:00:00.500Z');
    expect(parsed).toEqual({ physical: AT + 500, counter: 0, node: '' });
  });

  it('trata vazio e lixo como ilegivel', () => {
    expect(parseHlc('')).toBeNull();
    expect(parseHlc(null)).toBeNull();
    expect(parseHlc('nao-e-versao')).toBeNull();
  });

  it('ordena por fisico, contador e no', () => {
    const base = { physical: AT, counter: 0, node: 'a' };
    const list = [
      base,
      { physical: AT, counter: 1, node: 'a' },
      { physical: AT, counter: 1, node: 'b' },
      { physical: AT + 1, counter: 0, node: 'a' },
    ];
    for (let i = 1; i < list.length; i += 1) {
      expect(compareHlc(list[i - 1], list[i])).toBeLessThan(0);
      expect(list[i - 1] && formatHlc(list[i - 1]) < formatHlc(list[i])).toBe(true);
    }
  });

  it('so considera mais novo quando o token e legivel', () => {
    expect(versionAfter(formatHlc({ physical: AT, counter: 0, node: 'b' }), formatHlc({ physical: AT, counter: 0, node: 'a' }))).toBe(true);
    expect(versionAfter('2026-10-30T12:00:01Z', '2026-10-30T12:00:00Z')).toBe(true);
    expect(versionAfter('', '2026-10-30T12:00:00Z')).toBe(false);
    expect(versionAfter('lixo', '2026-10-30T12:00:00Z')).toBe(false);
    expect(versionAfter('2026-10-30T12:00:00Z', '2026-10-30T12:00:00Z')).toBe(false);
  });

  it('devolve o instante da versao para ordenar', () => {
    expect(versionTime(formatHlc({ physical: AT, counter: 9, node: 'x' }))).toBe(AT);
    expect(versionTime('2026-10-30T12:00:00Z')).toBe(AT);
    expect(versionTime('lixo')).toBe(0);
  });

  it('avanca o contador quando o relogio de parede para ou volta', () => {
    const first = nextHlc(null, AT, 'dev');
    expect(first).toEqual({ physical: AT, counter: 0, node: 'dev' });
    const same = nextHlc(first, AT, 'dev');
    expect(same).toEqual({ physical: AT, counter: 1, node: 'dev' });
    const back = nextHlc(same, AT - 60_000, 'dev');
    expect(back).toEqual({ physical: AT, counter: 2, node: 'dev' });
    const forward = nextHlc(back, AT + 10, 'dev');
    expect(forward).toEqual({ physical: AT + 10, counter: 0, node: 'dev' });
  });

  it('recebe um stamp remoto e nunca regride', () => {
    const local = { physical: AT, counter: 1, node: 'dev' };
    const remote = { physical: AT + 5000, counter: 0, node: 'srv' };
    expect(observeHlc(local, remote)).toEqual(remote);
    expect(observeHlc(remote, local)).toEqual(remote);
    expect(observeHlc(null, remote)).toEqual(remote);
  });
});
