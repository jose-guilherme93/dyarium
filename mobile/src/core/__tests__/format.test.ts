import {
  formatBytes,
  formatDateTime,
  formatDuration,
  formatStamp,
  titleFontSize,
  utf8ByteLength,
} from '../format';

describe('formatBytes', () => {
  it('formata bytes, KB, MB e GB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024 * 5)).toBe('5.0 MB');
    expect(formatBytes(1024 ** 3 * 2)).toBe('2.0 GB');
  });

  it('nao quebra com valores invalidos', () => {
    expect(formatBytes(NaN)).toBe('0 B');
    expect(formatBytes(-10)).toBe('0 B');
  });
});

describe('formatDuration', () => {
  it('formata mm:ss e h:mm:ss', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(65_000)).toBe('01:05');
    expect(formatDuration(3_661_000)).toBe('1:01:01');
  });

  it('nao quebra com valores invalidos', () => {
    expect(formatDuration(-5)).toBe('00:00');
    expect(formatDuration(NaN)).toBe('00:00');
  });
});

describe('utf8ByteLength', () => {
  it('conta bytes ascii e multibyte', () => {
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength('cafe')).toBe(4);
    expect(utf8ByteLength('café')).toBe(5);
    expect(utf8ByteLength('')).toBe(0);
  });
});

describe('titleFontSize', () => {
  it('mantem a fonte base para titulo curto', () => {
    expect(titleFontSize('Curto')).toBe(34);
  });

  it('diminui em titulo longo e respeita o piso legivel', () => {
    expect(titleFontSize('x'.repeat(80))).toBeLessThan(34);
    expect(titleFontSize('x'.repeat(80))).toBeGreaterThanOrEqual(24);
    expect(titleFontSize('x'.repeat(500))).toBe(24);
  });
});

describe('formatDateTime', () => {
  it('formata DD/MM/AAAA HH:mm', () => {
    expect(formatDateTime('2026-10-10T22:05:00')).toBe('10/10/2026 22:05');
  });

  it('devolve vazio para data invalida', () => {
    expect(formatDateTime('nao-e-data')).toBe('');
  });
});

describe('formatStamp', () => {
  const now = new Date(2026, 9, 16, 12, 0);
  it('hoje mostra so a hora', () => {
    expect(formatStamp(new Date(2026, 9, 16, 9, 5).toISOString(), now)).toBe('09:05');
  });
  it('mesmo ano mostra dia/mes e hora', () => {
    expect(formatStamp(new Date(2026, 9, 10, 22, 5).toISOString(), now)).toBe('10/10 22:05');
  });
  it('outro ano mostra a data completa', () => {
    expect(formatStamp(new Date(2025, 0, 3, 9, 7).toISOString(), now)).toBe('03/01/2025');
  });
});
