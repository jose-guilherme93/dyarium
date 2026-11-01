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

export const UPLOAD_TASK = 'dyarium-upload-queue';

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
