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

export const UPLOAD_TASK = 'dyarium-upload-queue';

TaskManager.defineTask(UPLOAD_TASK, async () => {
  try {
    const { runUploadQueueOnce } = await import('./uploaderLoop');
    await runUploadQueueOnce();
    // Retoma transcricoes locais pendentes (audio ainda sem transcricao).
    const { transcribePendingLocally } = await import('./localTranscription');
    await transcribePendingLocally();
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
