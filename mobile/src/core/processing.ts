/**
 * Onde cada etapa roda.
 *
 * App e servidor sao pares: cada um tem o proprio banco e o sync leva o que ja
 * foi feito. Por isso a decisao aqui e so **quem comeca** — o outro lado nunca
 * refaz nada por conta propria.
 *
 * Tres interruptores nas configuracoes alimentam esta funcao: transcrever,
 * analisar e processar no servidor. Sem servidor configurado, o servidor nao e
 * uma opcao; com o motor nativo ausente, o aparelho nao e.
 */

export type ProcessingPlace = 'disabled' | 'device' | 'server';

export interface ProcessingInput {
  /** O usuario quer esta etapa (interruptor da etapa). */
  enabled: boolean;
  /** O usuario escolheu processar no servidor. */
  serverProcessing: boolean;
  /** Ha servidor configurado. */
  hasServer: boolean;
  /** O build tem o motor nativo desta etapa. */
  deviceCapable: boolean;
  /** O modelo necessario para rodar no aparelho ja esta baixado. */
  deviceReady: boolean;
}

export interface ProcessingDecision {
  place: ProcessingPlace;
  /** Roda no aparelho agora (ligado, escolhido e com modelo). */
  runsOnDevice: boolean;
  /** Escolhido para o aparelho, mas falta baixar o modelo. */
  needsModel: boolean;
}

/**
 * Decide o lugar de uma etapa. Desligada ganha de tudo; o servidor so entra se
 * existir; o aparelho so entra se o build tiver o motor.
 */
export function decideProcessing(input: ProcessingInput): ProcessingDecision {
  if (!input.enabled) {
    return { place: 'disabled', runsOnDevice: false, needsModel: false };
  }
  if (input.serverProcessing && input.hasServer) {
    return { place: 'server', runsOnDevice: false, needsModel: false };
  }
  if (!input.deviceCapable) {
    // Sem motor nativo nao ha como rodar aqui. Com servidor, ele e o unico
    // executor possivel; sem servidor, a etapa fica desligada na pratica.
    return input.hasServer
      ? { place: 'server', runsOnDevice: false, needsModel: false }
      : { place: 'disabled', runsOnDevice: false, needsModel: false };
  }
  return {
    place: 'device',
    runsOnDevice: input.deviceReady,
    needsModel: !input.deviceReady,
  };
}

/**
 * O cliente se responsabiliza pela etapa?
 *
 * `true` quando roda no aparelho **ou** quando esta desligada: nos dois casos o
 * servidor nao deve enfileirar nada. So um `server` explicito entrega o
 * trabalho para la.
 */
export function clientOwnsStage(place: ProcessingPlace): boolean {
  return place !== 'server';
}
