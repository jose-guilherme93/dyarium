/**
 * Tarefa em primeiro plano (Android): mantem o processo vivo durante uma
 * transcricao longa e mostra o progresso na notificacao. Sem o modulo nativo
 * (build antigo), as funcoes viram no-op.
 *
 * O fim e adiado por alguns segundos. Entre uma nota e a revisao (ou entre duas
 * notas da fila) o servico nao chega a morrer: o Android 12+ nao deixa abrir um
 * servico em primeiro plano a partir do fundo, e essa emenda e o que evita o
 * processo ser encerrado no meio da cadeia.
 */

import { requireOptionalNativeModule } from 'expo';

interface ForegroundTaskModule {
  start(title: string, text: string, percent?: number): Promise<boolean>;
  /** Existe a partir do build que mostra a barra de progresso. */
  update?(title: string, text: string, percent: number): Promise<boolean>;
  stop(): Promise<boolean>;
}

const native = requireOptionalNativeModule<ForegroundTaskModule>('ForegroundTask');
const STOP_GRACE_MS = 4000;
let stopTimer: ReturnType<typeof setTimeout> | null = null;

function cancelScheduledStop(): void {
  if (stopTimer) clearTimeout(stopTimer);
  stopTimer = null;
}

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
  cancelScheduledStop();
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

/**
 * Encerra a tarefa. A parada real espera alguns segundos para a proxima etapa
 * da mesma cadeia (transcricao -> revisao -> analise) reaproveitar o servico.
 */
export function stopForegroundTask(): void {
  if (!native) return;
  cancelScheduledStop();
  stopTimer = setTimeout(() => {
    stopTimer = null;
    try {
      void native.stop().catch(() => undefined);
    } catch {
      // servico ja parado
    }
  }, STOP_GRACE_MS);
}
