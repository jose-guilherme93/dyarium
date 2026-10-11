import {
  analyzeShareAudio,
  buildShareFileName,
  draftToRecording,
  extensionFor,
  formatBrDateTime,
  mimeForExtension,
  parseBrDateTime,
  parseNameDate,
  parseUsDateTime,
  resolveRecordedAt,
  type ImportDraft,
} from '../import';

const NOW = new Date('2026-10-10T22:00:00.000Z');

describe('extensionFor', () => {
  it('aceita a extensao do proprio nome', () => {
    expect(extensionFor({ uri: 'content://x/y', name: 'nota.m4a' })).toBe('m4a');
    expect(extensionFor({ uri: 'file:///tmp/a.wav' })).toBe('wav');
  });

  it('cai para o mime quando o nome nao tem extensao util', () => {
    expect(extensionFor({ uri: 'content://x/1', name: 'gravacao', mimeType: 'audio/mpeg' })).toBe(
      'mp3',
    );
    expect(extensionFor({ uri: 'content://x/1', mimeType: 'audio/x-m4a' })).toBe('m4a');
  });

  it('recusa formato fora da whitelist', () => {
    expect(extensionFor({ uri: 'content://x/1', name: 'nota.txt' })).toBeNull();
    expect(extensionFor({ uri: 'content://x/1', name: 'voz.opus', mimeType: 'audio/opus' })).toBeNull();
  });
});

describe('parseUsDateTime e formatBrDateTime', () => {
  it('converte mes/dia/ano americano para brasileiro', () => {
    const date = parseUsDateTime('12/25/2025 10:30 AM');
    expect(date).not.toBeNull();
    expect(formatBrDateTime(date as Date)).toBe('25/12/2025 10:30');
  });

  it('entende dia-primeiro quando o primeiro campo passa de 12', () => {
    const date = parseUsDateTime('25/12/2025 18:05');
    expect(date).not.toBeNull();
    expect(formatBrDateTime(date as Date)).toBe('25/12/2025 18:05');
  });

  it('entende ano na frente (ISO)', () => {
    const date = parseUsDateTime('2025-12-25 18:05');
    expect(date).not.toBeNull();
    expect(formatBrDateTime(date as Date)).toBe('25/12/2025 18:05');
  });

  it('nao adivinha quando dia e mes sao ambiguos', () => {
    expect(parseUsDateTime('03/04/2025')).toBeNull();
    expect(parseUsDateTime('10/10/2026 18:05')).toBeNull();
  });

  it('ignora texto sem data', () => {
    expect(parseUsDateTime('minha nota de voz')).toBeNull();
  });
});

describe('parseBrDateTime', () => {
  it('interpreta o formato brasileiro', () => {
    const date = parseBrDateTime('25/12/2025 08:07');
    expect(date).not.toBeNull();
    expect(formatBrDateTime(date as Date)).toBe('25/12/2025 08:07');
  });

  it('rejeita formatos invalidos', () => {
    expect(parseBrDateTime('2025-12-25')).toBeNull();
    expect(parseBrDateTime('31/02/2025')).toBeNull();
    expect(parseBrDateTime('25/12/2025 25:00')).toBeNull();
  });

  it('aceita e interpreta AM/PM', () => {
    expect(formatBrDateTime(parseBrDateTime('25/12/2025 10:30 PM') as Date, false)).toBe(
      '25/12/2025 10:30 PM',
    );
    expect(formatBrDateTime(parseBrDateTime('25/12/2025 12:05 AM') as Date, true)).toBe(
      '25/12/2025 00:05',
    );
    expect(parseBrDateTime('25/12/2025 13:00 PM')).toBeNull();
  });
});

describe('formatBrDateTime', () => {
  it('formata em 24h por padrao', () => {
    expect(formatBrDateTime(new Date(2025, 11, 25, 18, 5))).toBe('25/12/2025 18:05');
  });

  it('formata em AM/PM quando pedido', () => {
    expect(formatBrDateTime(new Date(2025, 11, 25, 18, 5), false)).toBe('25/12/2025 06:05 PM');
    expect(formatBrDateTime(new Date(2025, 11, 25, 0, 30), false)).toBe('25/12/2025 12:30 AM');
    expect(formatBrDateTime(new Date(2025, 11, 25, 12, 0), false)).toBe('25/12/2025 12:00 PM');
  });
});

describe('analyzeShareAudio', () => {
  it('usa o nome do arquivo como titulo e a data do nome', () => {
    const analysis = analyzeShareAudio(
      { uri: 'content://x/y', name: '12-25-2025 10:30 AM.m4a', mimeType: 'audio/mp4' },
      { now: NOW },
    );
    expect(analysis.supported).toBe(true);
    expect(analysis.title).toBe('12-25-2025 10:30 AM');
    expect(analysis.extension).toBe('m4a');
    expect(analysis.contentType).toBe('audio/mp4');
    expect(formatBrDateTime(new Date(analysis.recordedAt))).toBe('25/12/2025 10:30');
  });

  it('cai para a data de modificacao quando o nome nao tem data', () => {
    const modified = new Date('2024-05-01T12:00:00.000Z');
    const analysis = analyzeShareAudio(
      { uri: 'content://x/y', name: 'minha nota.m4a' },
      { now: NOW, lastModifiedMs: modified.getTime() },
    );
    expect(analysis.recordedAt).toBe(modified.toISOString());
  });

  it('interpreta nome ambiguo como dia primeiro, com o ano do nome', () => {
    const analysis = analyzeShareAudio(
      { uri: 'content://x/y', name: '03-04-2025.m4a' },
      { now: NOW },
    );
    expect(formatBrDateTime(new Date(analysis.recordedAt))).toBe('03/04/2025 00:00');
  });

  it('expoe a data extraida do nome para a revisao ajustar', () => {
    const analysis = analyzeShareAudio(
      { uri: 'content://x/y', name: '25/12 18:05.m4a' },
      { now: NOW },
    );
    expect(analysis.date).toMatchObject({ a: 25, b: 12, order: 'day-first', hour: 18, minute: 5 });
  });

  it('bloqueia formato nao suportado sem copiar', () => {
    const analysis = analyzeShareAudio({ uri: 'content://x/y', name: 'anotacao.txt' }, { now: NOW });
    expect(analysis.supported).toBe(false);
    expect(analysis.reason).toBeTruthy();
  });
});

describe('parseNameDate', () => {
  it('detecta mes/dia quando o segundo campo passa de 12', () => {
    expect(parseNameDate('12-25-2025 10:30 AM')).toMatchObject({
      a: 12,
      b: 25,
      year: 2025,
      order: 'month-first',
      hour: 10,
      minute: 30,
    });
  });

  it('detecta dia/mes quando o primeiro campo passa de 12 (sem ano)', () => {
    const date = parseNameDate('25/12 18:05');
    expect(date).toMatchObject({ a: 25, b: 12, order: 'day-first', hour: 18, minute: 5 });
    expect(date?.year).toBeUndefined();
  });

  it('marca como unknown quando dia e mes sao ambos <= 12', () => {
    const date = parseNameDate('03/04 08:00');
    expect(date?.order).toBe('unknown');
    expect(date?.year).toBeUndefined();
  });

  it('aceita so a data (ISO)', () => {
    expect(parseNameDate('2023-05-01')).toMatchObject({ year: 2023, order: 'month-first' });
  });

  it('devolve null sem data', () => {
    expect(parseNameDate('minha nota de voz')).toBeNull();
  });
});

describe('resolveRecordedAt', () => {
  const fallback = new Date('2026-10-10T22:00:00.000Z');

  it('usa o ano escolhido quando o nome nao tem ano', () => {
    const date = parseNameDate('25/12 18:05');
    expect(formatBrDateTime(resolveRecordedAt(date, { year: 2019, invert: false, fallback }))).toBe(
      '25/12/2019 18:05',
    );
  });

  it('inverte dia/mes quando pedido (nome ambiguo)', () => {
    const date = parseNameDate('03/04 08:00');
    expect(formatBrDateTime(resolveRecordedAt(date, { year: 2020, invert: false, fallback }))).toBe(
      '03/04/2020 08:00',
    );
    expect(formatBrDateTime(resolveRecordedAt(date, { year: 2020, invert: true, fallback }))).toBe(
      '04/03/2020 08:00',
    );
  });

  it('o ano do nome vence o ano escolhido', () => {
    const date = parseNameDate('12-25-2025 10:30');
    expect(formatBrDateTime(resolveRecordedAt(date, { year: 2000, invert: false, fallback }))).toBe(
      '25/12/2025 10:30',
    );
  });

  it('sem data no nome usa o fallback', () => {
    expect(resolveRecordedAt(null, { year: 2020, invert: false, fallback })).toBe(fallback);
  });
});

describe('buildShareFileName', () => {
  it('remove acentos e forca a extensao aceita', () => {
    expect(buildShareFileName('Reuniao de equipe 12/25', 'm4a')).toBe(
      'Reuniao de equipe 1225.m4a',
    );
  });

  it('tem fallback quando o titulo fica vazio', () => {
    expect(buildShareFileName('///', 'mp3')).toBe('audio.mp3');
  });
});

describe('draftToRecording', () => {
  it('monta o Recording de importacao', () => {
    const draft: ImportDraft = {
      key: 'imp_1',
      title: 'Minha nota',
      recordedAt: '2025-12-25T13:30:00.000Z',
      originalName: '12/25/2025 10:30 AM.m4a',
      supported: true,
      contentType: 'audio/mp4',
      extension: 'm4a',
      sizeBytes: 2048,
      id: 'rec_1',
      dir: 'sess/rec_1',
      filePath: 'sess/rec_1/original.m4a',
      fileName: 'Minha nota.m4a',
    };
    const recording = draftToRecording(draft, NOW);
    expect(recording.source).toBe('share');
    expect(recording.status).toBe('recorded');
    expect(recording.contentType).toBe('audio/mp4');
    expect(recording.fileName).toBe('Minha nota.m4a');
    expect(recording.filePath).toBe('sess/rec_1/original.m4a');
    expect(recording.sizeBytes).toBe(2048);
  });

  it('recusa rascunho incompleto', () => {
    const draft: ImportDraft = {
      key: 'imp_2',
      title: 'x',
      recordedAt: NOW.toISOString(),
      originalName: 'x.m4a',
      supported: true,
    };
    expect(() => draftToRecording(draft, NOW)).toThrow();
  });
});

describe('mimeForExtension', () => {
  it('mapeia as extensoes aceitas', () => {
    expect(mimeForExtension('mp3')).toBe('audio/mpeg');
    expect(mimeForExtension('m4a')).toBe('audio/mp4');
    expect(mimeForExtension('desconhecida')).toBe('application/octet-stream');
  });
});
