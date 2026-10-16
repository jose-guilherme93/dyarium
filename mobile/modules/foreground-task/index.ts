/**
 * Tarefa em primeiro plano (Android): mantem o processo vivo durante uma
 * transcricao longa, mostrando uma notificacao discreta. Sem o modulo nativo
 * (build antigo), as funcoes viram no-op.
 */

import { requireOptionalNativeModule } from 'expo';

interface ForegroundTaskModule {
  start(title: string, text: string): Promise<boolean>;
  stop(): Promise<boolean>;
}

const native = requireOptionalNativeModule<ForegroundTaskModule>('ForegroundTask');

export function foregroundTaskAvailable(): boolean {
  return native != null;
}

export function startForegroundTask(title: string, text: string): void {
  void native?.start(title, text).catch(() => undefined);
}

export function stopForegroundTask(): void {
  void native?.stop().catch(() => undefined);
}
