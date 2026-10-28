import {
  TRASH_RETENTION_DAYS,
  isTrashExpired,
  trashDaysLeft,
  trashExpiresAt,
} from '../trash';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-28T12:00:00.000Z');

describe('trash', () => {
  it('expira exatamente depois de 7 dias', () => {
    const deletedAt = new Date(NOW - DAY).toISOString();
    expect(trashExpiresAt(deletedAt)).toBe(NOW - DAY + TRASH_RETENTION_DAYS * DAY);
    expect(isTrashExpired(deletedAt, NOW)).toBe(false);
    expect(isTrashExpired(deletedAt, NOW + 6 * DAY + DAY)).toBe(true);
  });

  it('conta os dias restantes dentro da janela', () => {
    expect(trashDaysLeft(new Date(NOW).toISOString(), NOW)).toBe(7);
    expect(trashDaysLeft(new Date(NOW - 2 * DAY).toISOString(), NOW)).toBe(5);
    expect(trashDaysLeft(new Date(NOW - 6 * DAY - 12 * 60 * 60 * 1000).toISOString(), NOW)).toBe(1);
    expect(trashDaysLeft(new Date(NOW - 7 * DAY).toISOString(), NOW)).toBe(0);
  });

  it('data invalida nao apaga nem inventa prazo curto', () => {
    expect(isTrashExpired('nao e data', NOW)).toBe(false);
    expect(trashDaysLeft('nao e data', NOW)).toBe(TRASH_RETENTION_DAYS);
  });
});
