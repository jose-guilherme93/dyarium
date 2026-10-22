/**
 * Tarefa em primeiro plano (Android): mantem o processo vivo durante uma
 * transcricao longa e mostra o progresso na notificacao. Sem o modulo nativo
 * (build antigo), as funcoes viram no-op.
 */

import { requireOptionalNativeModule } from 'expo';

interface ForegroundTaskModule {
  start(title: string, text: string, percent: number): Promise<boolean>;
  update(title: string, text: string, percent: number): Promise<boolean>;
  stop(): Promise<boolean>;
}

const native = requireOptionalNativeModule<ForegroundTaskModule>('ForegroundTask');

export function foregroundTaskAvailable(): boolean {
  return native != null;
}

/** Inicia (ou reatualiza) a notificacao; `percent` negativo = sem barra. */
export function startForegroundTask(title: string, text: string, percent = -1): void {
  void native?.start(title, text, percent).catch(() => undefined);
}

/** Atualiza texto e barra da notificacao que ja esta na tela. */
export function updateForegroundTask(title: string, text: string, percent: number): void {
  void native?.update(title, text, percent).catch(() => undefined);
}

export function stopForegroundTask(): void {
  void native?.stop().catch(() => undefined);
}
