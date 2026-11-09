/**
 * Matematica pura das rotinas de backup local (diario/semanal/mensal).
 * Nada de IO, nada de React. Tudo em horario local, sem dependencias.
 */

export type BackupFrequency = 'off' | 'daily' | 'weekly' | 'monthly';

export const BACKUP_FREQUENCIES: BackupFrequency[] = [
  'off',
  'daily',
  'weekly',
  'monthly',
];

/** Aceita apenas os quatro valores validos; qualquer outra coisa vira 'off'. */
export function normalizeBackupFrequency(value: unknown): BackupFrequency {
  if (typeof value === 'string' && BACKUP_FREQUENCIES.includes(value as BackupFrequency)) {
    return value as BackupFrequency;
  }
  return 'off';
}

/** Rotulo do seletor de rotina. Um lugar so, para nenhuma tela voltar a
 * mostrar valor de exemplo no lugar do texto. */
export function backupFrequencyLabel(frequency: BackupFrequency): string {
  switch (frequency) {
    case 'off':
      return 'Desligado';
    case 'daily':
      return 'Diário';
    case 'weekly':
      return 'Semanal';
    case 'monthly':
      return 'Mensal';
  }
}

/** Limite mais recente que ja passou (00:00 local), ou null para 'off'. */
export function lastBoundary(frequency: BackupFrequency, now: Date): Date | null {
  if (frequency === 'off') return null;
  const ano = now.getFullYear();
  const mes = now.getMonth();
  const dia = now.getDate();

  switch (frequency) {
    case 'daily':
      return new Date(ano, mes, dia);
    case 'weekly': {
      // Domingo mais recente (0 = domingo). Se hoje for domingo, e hoje mesmo.
      const domingoMaisProximo = new Date(ano, mes, dia - now.getDay());
      return new Date(domingoMaisProximo.getFullYear(), domingoMaisProximo.getMonth(), domingoMaisProximo.getDate());
    }
    case 'monthly':
      return new Date(ano, mes, 1);
  }
}

/** Proximo limite (00:00 local), estritamente depois de now, ou null para 'off'. */
export function nextBackupAt(frequency: BackupFrequency, now: Date): Date | null {
  if (frequency === 'off') return null;
  const ano = now.getFullYear();
  const mes = now.getMonth();
  const dia = now.getDate();

  switch (frequency) {
    case 'daily':
      return new Date(ano, mes, dia + 1);
    case 'weekly': {
      const domingoMaisProximo = new Date(ano, mes, dia - now.getDay());
      const proximoDomingo = new Date(
        domingoMaisProximo.getFullYear(),
        domingoMaisProximo.getMonth(),
        domingoMaisProximo.getDate() + 7,
      );
      return new Date(proximoDomingo.getFullYear(), proximoDomingo.getMonth(), proximoDomingo.getDate());
    }
    case 'monthly': {
      // Primeiro dia do mes seguinte (dezembro vira janeiro do ano seguinte).
      return new Date(ano, mes + 1, 1);
    }
  }
}

/**
 * lastRunAt ausente/invalido conta como "nunca rodou" -> devido.
 * 'off' nunca e devido. Se o limite for null -> false.
 */
export function isBackupDue(
  frequency: BackupFrequency,
  lastRunAt: string | undefined,
  now: Date,
): boolean {
  if (frequency === 'off') return false;

  const boundary = lastBoundary(frequency, now);
  if (boundary === null) return false;

  if (!lastRunAt || lastRunAt === '') return true;

  const parsed = Date.parse(lastRunAt);
  if (isNaN(parsed)) return true;

  return parsed < boundary.getTime();
}
