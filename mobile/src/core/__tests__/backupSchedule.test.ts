import {
  backupFrequencyLabel,
  isBackupDue,
  lastBoundary,
  nextBackupAt,
  normalizeBackupFrequency,
} from '../backupSchedule';

describe('backupFrequencyLabel', () => {
  it('rotula as quatro rotinas, sem valor de exemplo', () => {
    expect(backupFrequencyLabel('off')).toBe('Desligado');
    expect(backupFrequencyLabel('daily')).toBe('Diário');
    expect(backupFrequencyLabel('weekly')).toBe('Semanal');
    expect(backupFrequencyLabel('monthly')).toBe('Mensal');
    for (const label of ['Desligado', 'Diário', 'Semanal', 'Mensal']) {
      expect(label).not.toContain('[');
    }
  });
});

describe('normalizeBackupFrequency', () => {
  it('aceita os quatro valores validos', () => {
    expect(normalizeBackupFrequency('off')).toBe('off');
    expect(normalizeBackupFrequency('daily')).toBe('daily');
    expect(normalizeBackupFrequency('weekly')).toBe('weekly');
    expect(normalizeBackupFrequency('monthly')).toBe('monthly');
  });

  it('cai em off para lixo e null', () => {
    expect(normalizeBackupFrequency(null)).toBe('off');
    expect(normalizeBackupFrequency(undefined)).toBe('off');
    expect(normalizeBackupFrequency('')).toBe('off');
    expect(normalizeBackupFrequency('diario')).toBe('off');
    expect(normalizeBackupFrequency(123)).toBe('off');
    expect(normalizeBackupFrequency({})).toBe('off');
  });
});

describe('lastBoundary (limite mais recente ja passado)', () => {
  const sexta = new Date(2026, 10, 6, 23, 0); // 6/11/2026 (sexta-feira)
  const domingo = new Date(2026, 10, 8, 0, 0); // 8/11/2026 (domingo)

  it('daily: hoje 00:00', () => {
    const boundary = lastBoundary('daily', sexta);
    expect(boundary).not.toBeNull();
    expect(boundary!.getTime()).toBe(new Date(2026, 10, 6, 0, 0).getTime());
  });

  it('weekly: domingo mais recente (sexta -> domingo 1/11)', () => {
    const boundary = lastBoundary('weekly', sexta);
    expect(boundary).not.toBeNull();
    expect(boundary!.getTime()).toBe(new Date(2026, 10, 1, 0, 0).getTime());
  });

  it('weekly: domingo mesmo, limite e o proprio domingo', () => {
    const boundary = lastBoundary('weekly', domingo);
    expect(boundary).not.toBeNull();
    expect(boundary!.getTime()).toBe(new Date(2026, 10, 8, 0, 0).getTime());
  });

  it('monthly: dia 1 do mes atual', () => {
    const boundary = lastBoundary('monthly', sexta);
    expect(boundary).not.toBeNull();
    expect(boundary!.getTime()).toBe(new Date(2026, 10, 1, 0, 0).getTime());
  });

  it('off: null', () => {
    expect(lastBoundary('off', sexta)).toBeNull();
  });
});

describe('nextBackupAt (primeiro limite estritamente depois de now)', () => {
  const sexta = new Date(2026, 10, 6, 23, 0); // 6/11/2026
  const domingoMeiaNoite = new Date(2026, 10, 8, 0, 0); // 8/11/2026 00:00
  const diaUmMesmaNoite = new Date(2026, 10, 1, 0, 0); // 1/11/2026 00:00
  const primeiroDezembro = new Date(2026, 11, 1, 0, 0); // 1/12/2026 00:00

  it('daily: dia 6 as 23h -> dia 7 00:00', () => {
    const boundary = nextBackupAt('daily', sexta);
    expect(boundary).not.toBeNull();
    expect(boundary!.getTime()).toBe(new Date(2026, 10, 7, 0, 0).getTime());
  });

  it('daily: exatamente dia 7 00:00 -> dia 8 00:00', () => {
    const boundary = nextBackupAt('daily', new Date(2026, 10, 7, 0, 0));
    expect(boundary).not.toBeNull();
    expect(boundary!.getTime()).toBe(new Date(2026, 10, 8, 0, 0).getTime());
  });

  it('weekly: sexta 6/11 -> domingo 8/11 00:00', () => {
    const boundary = nextBackupAt('weekly', sexta);
    expect(boundary).not.toBeNull();
    expect(boundary!.getTime()).toBe(new Date(2026, 10, 8, 0, 0).getTime());
  });

  it('weekly: domingo 8 as 00:00 -> proximo domingo 15/11 00:00', () => {
    const boundary = nextBackupAt('weekly', domingoMeiaNoite);
    expect(boundary).not.toBeNull();
    expect(boundary!.getTime()).toBe(new Date(2026, 10, 15, 0, 0).getTime());
  });

  it('monthly: dia 6/11 -> 1/12 00:00', () => {
    const boundary = nextBackupAt('monthly', sexta);
    expect(boundary).not.toBeNull();
    expect(boundary!.getTime()).toBe(primeiroDezembro.getTime());
  });

  it('monthly: dia 1 as 00:00 -> dia 1 do mes seguinte', () => {
    const boundary = nextBackupAt('monthly', diaUmMesmaNoite);
    expect(boundary).not.toBeNull();
    expect(boundary!.getTime()).toBe(primeiroDezembro.getTime());
  });

  it('monthly: dezembro -> janeiro do ano seguinte', () => {
    const boundary = nextBackupAt('monthly', new Date(2026, 11, 6, 0, 0));
    expect(boundary).not.toBeNull();
    expect(boundary!.getTime()).toBe(new Date(2027, 0, 1, 0, 0).getTime());
  });

  it('off: null', () => {
    expect(nextBackupAt('off', sexta)).toBeNull();
  });
});

describe('isBackupDue', () => {
  const sexta = new Date(2026, 10, 6, 23, 0); // 6/11/2026 23:00

  it('off nunca e devido', () => {
    expect(isBackupDue('off', '2026-11-01T00:00:00.000Z', sexta)).toBe(false);
    expect(isBackupDue('off', undefined, sexta)).toBe(false);
  });

  it('lastRunAt ausente -> devido', () => {
    expect(isBackupDue('daily', undefined, sexta)).toBe(true);
  });

  it('lastRunAt vazio -> devido', () => {
    expect(isBackupDue('daily', '', sexta)).toBe(true);
  });

  it('lastRunAt invalido -> devido', () => {
    expect(isBackupDue('daily', 'nao-e-data', sexta)).toBe(true);
  });

  it('daily: ultima execucao dia 5 23:59 -> devido no dia 6 00:01', () => {
    const now = new Date(2026, 10, 6, 0, 1);
    expect(isBackupDue('daily', '2026-11-05T23:59:00', now)).toBe(true);
  });

  it('daily: ultima execucao dia 6 00:01 -> nao devido no dia 6 23:59', () => {
    expect(isBackupDue('daily', '2026-11-06T00:01:00', sexta)).toBe(false);
  });

  it('daily: ultima execucao exatamente dia 6 00:00 -> nao devido', () => {
    const now = new Date(2026, 10, 6, 23, 59);
    expect(isBackupDue('daily', '2026-11-06T00:00:00', now)).toBe(false);
  });
});
