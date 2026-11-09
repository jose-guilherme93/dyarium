/**
 * Rotina de backup "de meia-noite": roda no primeiro momento em que o app
 * abre ou o sistema acorda depois do limite (00:00 local). O sistema
 * operacional nao garante a hora exata, entao o agendador so confere "ja
 * passou do limite?" (isBackupDue). Tudo aqui eh melhor esforço: sem pasta
 * ou rotina desligada, nao faz nada; execucoes concorrentes sao serializadas
 * pela trava `inFlight`.
 */

import { isBackupDue, normalizeBackupFrequency } from '@/core/backupSchedule';
import { loadPrefs, savePrefs } from './secure';
import { runBackup, type BackupSummary } from './backup';

let inFlight: Promise<BackupSummary | null> | null = null;

/** Roda o backup automático se o limite (00:00 local) já passou e há pasta. */
export async function runScheduledBackupIfDue(): Promise<BackupSummary | null> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const prefs = await loadPrefs();
    const frequency = normalizeBackupFrequency(prefs.backupFrequency);
    const folder = prefs.backupFolder;
    if (!folder || !isBackupDue(frequency, prefs.backupLastRunAt, new Date())) {
      return null;
    }
    const summary = await runBackup(folder);
    const current = await loadPrefs();
    await savePrefs({ ...current, backupLastRunAt: new Date().toISOString() });
    return summary;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}
