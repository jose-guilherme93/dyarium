/**
 * Retomada oportunista da fila em segundo plano (WorkManager no Android).
 *
 * Observacao de escopo: o Expo nao oferece um foreground service generico para
 * upload. Este task cobre "app fechado" de forma best-effort (o sistema decide
 * quando acordar). A gravacao, que e o requisito critico, usa o foreground
 * service do expo-audio e continua com a tela bloqueada.
 */

import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';

import { normalizeBackupFrequency, type BackupFrequency } from '@/core/backupSchedule';
import { loadPrefs } from './secure';

export const UPLOAD_TASK = 'dyarium-upload-queue';
export const BACKUP_TASK = 'dyarium-backup';

TaskManager.defineTask(UPLOAD_TASK, async () => {
  // O WorkManager pode acordar a task com o app na frente. Upload e, acima de
  // tudo, a nota ou a gravacao disputariam CPU/SQLite: nesse caso a task
  // termina sem trabalho e tenta de novo no proximo ciclo.
  if (AppState.currentState === 'active') return BackgroundTask.BackgroundTaskResult.Success;
  try {
    const { runUploadQueueOnce } = await import('./uploaderLoop');
    await runUploadQueueOnce();
    // A reconciliacao entre ambientes tambem e best-effort no fundo: a fila
    // normal ja subiu para o primario; isto leva as notas novas aos demais e
    // traz o que so existe la. Falha nao pode derrubar a tarefa.
    const { reconcileAllServers } = await import('./sync/engine');
    await reconcileAllServers().catch(() => undefined);
    // Transcricao local NAO entra aqui: o Android 12+ nao permite abrir o
    // servico em primeiro plano a partir do trabalho em segundo plano, e sem
    // ele o sistema encerra o processo no meio da passada. Transcricao e
    // analise rodam com o app aberto (ou sob um servico que ja esta na frente)
    // e retomam no boot pelo checkpoint.
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

TaskManager.defineTask(BACKUP_TASK, async () => {
  // Backup eh oportunista: se o usuario esta com o app na frente, nao rouba
  // CPU dele. So executa quando o sistema acorda o app em segundo plano.
  if (AppState.currentState === 'active') return BackgroundTask.BackgroundTaskResult.Success;
  try {
    const { runScheduledBackupIfDue } = await import('./backupScheduler');
    await runScheduledBackupIfDue();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerUploadTask(): Promise<void> {
  try {
    await BackgroundTask.registerTaskAsync(UPLOAD_TASK, { minimumInterval: 15 });
  } catch {
    // best-effort: sem permissao/suporte, seguimos apenas em primeiro plano
  }
}

export async function unregisterUploadTask(): Promise<void> {
  try {
    await BackgroundTask.unregisterTaskAsync(UPLOAD_TASK);
  } catch {
    // ignora
  }
}

/**
 * Liga/desliga o task de backup segundo a frequencia escolhida. 'off'
 * desregistra o task; qualquer outra frequencia registra com intervalo
 * minimo de 360 minutos (6h) — o proprio task confere se o limite ja passou.
 * Best-effort: sem permissao/suporte, o backup continua rodando em primeiro
 * plano pelo efeito de boot em _layout.
 */
export async function syncBackupTask(frequency: BackupFrequency): Promise<void> {
  if (frequency === 'off') {
    try {
      await BackgroundTask.unregisterTaskAsync(BACKUP_TASK);
    } catch {
      // ignora
    }
    return;
  }
  try {
    await BackgroundTask.registerTaskAsync(BACKUP_TASK, { minimumInterval: 360 });
  } catch {
    // best-effort: sem permissao/suporte, seguimos apenas em primeiro plano
  }
}

/** Lê as preferências e (re)registra o task de backup conforme a rotina salva. */
export async function registerBackupTaskFromPrefs(): Promise<void> {
  const prefs = await loadPrefs();
  const frequency = normalizeBackupFrequency(prefs.backupFrequency);
  await syncBackupTask(frequency);
}
