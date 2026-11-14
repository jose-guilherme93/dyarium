/**
 * Onde cada etapa roda.
 *
 * App e servidor sao pares independentes: cada um tem o proprio banco e o sync
 * leva o que ja foi feito. A escolha aqui e so **quem comeca** a etapa.
 *
 * Cada etapa tem quatro estados, e nunhum deles troca de lugar sozinho:
 * desligada, no aparelho, no servidor ou online direto (o aparelho chama o
 * provedor com a propria chave). Sem modelo, sem chave ou sem servidor a etapa
 * fica bloqueada e diz o que falta; nunca cai para outro lugar em silencio.
 */

export type ProcessingPlace = 'off' | 'device' | 'server' | 'online';

/** Estado resolvido: 'off' vira 'disabled' na tela e na fila. */
export type ResolvedPlace = 'disabled' | 'device' | 'server' | 'online';

export interface ProcessingInput {
  /** Escolha do usuario para esta etapa. */
  place: ProcessingPlace;
  /** Ha servidor conectado. */
  hasServer: boolean;
  /** O build tem o motor nativo desta etapa. */
  deviceCapable: boolean;
  /** O modelo necessario para rodar no aparelho esta baixado. */
  deviceReady: boolean;
  /** Provedor e chave do aparelho estao prontos. */
  onlineReady: boolean;
}

export interface ProcessingDecision {
  /** Destino escolhido (pode estar bloqueado). */
  place: ResolvedPlace;
  /** Este cliente comeca a etapa agora. */
  runsHere: boolean;
  /** Roda no motor nativo do aparelho (whisper/llama). */
  runsOnDevice: boolean;
  /** Falta baixar modelo. */
  needsModel: boolean;
  /** Falta chave do provedor online. */
  needsKey: boolean;
  /** Servidor escolhido mas nao conectado. */
  needsServer: boolean;
  /** A escolha nao pode ser cumprida agora. */
  blocked: boolean;
  /** O build nao tem o motor nativo desta etapa. */
  unsupported?: boolean;
}

/** Decisao de uma etapa. Nunca troca o lugar escolhido pelo usuario. */
export function decideProcessing(input: ProcessingInput): ProcessingDecision {
  switch (input.place) {
    case 'off':
      return decision('disabled');
    case 'server':
      return input.hasServer
        ? decision('server')
        : { ...decision('server'), needsServer: true, blocked: true };
    case 'online':
      return input.onlineReady
        ? { ...decision('online'), runsHere: true }
        : { ...decision('online'), needsKey: true, blocked: true };
    case 'device':
    default:
      if (!input.deviceCapable) {
        return { ...decision('device'), blocked: true, unsupported: true };
      }
      if (!input.deviceReady) {
        return { ...decision('device'), needsModel: true, blocked: true };
      }
      return { ...decision('device'), runsHere: true, runsOnDevice: true };
  }
}

function decision(place: ResolvedPlace): ProcessingDecision {
  return {
    place,
    runsHere: false,
    runsOnDevice: false,
    needsModel: false,
    needsKey: false,
    needsServer: false,
    blocked: false,
  };
}

/**
 * O cliente se responsabiliza pela etapa?
 *
 * `true` para aparelho, online e desligada: nos tres casos o servidor nao deve
 * enfileirar nada. So um `server` explicito entrega o trabalho para la.
 */
export function clientOwnsStage(place: ResolvedPlace): boolean {
  return place !== 'server';
}

/** A escolha salva e valida? Qualquer outra coisa vira desligado. */
export function normalizePlace(value: unknown): ProcessingPlace {
  return value === 'device' || value === 'server' || value === 'online' ? value : 'off';
}

/** Nome curto do lugar, como aparece nas Opcoes. */
export function placeLabel(place: ProcessingPlace): string {
  switch (place) {
    case 'device':
      return 'Aparelho';
    case 'server':
      return 'Servidor';
    case 'online':
      return 'Online';
    default:
      return 'Desligado';
  }
}
