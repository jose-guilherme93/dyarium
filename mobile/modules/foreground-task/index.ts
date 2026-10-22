/**
 * Tarefa em primeiro plano (Android): mantem o processo vivo durante uma
 * transcricao longa e mostra o progresso na notificacao. Sem o modulo nativo
 * (build antigo), as funcoes viram no-op.
 */

import { requireOptionalNativeModule } from 'expo';

interface ForegroundTaskModule {
  start(title: string, text: string, percent?: number): Promise<boolean>;
  /** Existe a partir do build que mostra a barra de progresso. */
  update?(title: string, text: string, percent: number): Promise<boolean>;
  stop(): Promise<boolean>;
}

const native = requireOptionalNativeModule<ForegroundTaskModule>('ForegroundTask');

export function foregroundTaskAvailable(): boolean {
  return native != null;
}

/**
 * Inicia (ou reatualiza) a notificacao; `percent` negativo = sem barra.
 *
 * No build antigo o metodo nativo so aceita titulo/texto: a chamada com tres
 * argumentos so acontece quando `update` existe (build novo).
 */
export function startForegroundTask(title: string, text: string, percent = -1): void {
  if (!native) return;
  try {
    const task =
      typeof native.update === 'function'
        ? native.start(title, text, percent)
        : native.start(title, text);
    void task.catch(() => undefined);
  } catch {
    // build sem o metodo novo: segue sem a barra
  }
}

/** Atualiza texto e barra da notificacao que ja esta na tela. */
export function updateForegroundTask(title: string, text: string, percent: number): void {
  if (typeof native?.update !== 'function') return;
  try {
    void native.update(title, text, percent).catch(() => undefined);
  } catch {
    // sem notificacao em tela
  }
}

export function stopForegroundTask(): void {
  if (!native) return;
  try {
    void native.stop().catch(() => undefined);
  } catch {
    // servico ja parado
  }
}
