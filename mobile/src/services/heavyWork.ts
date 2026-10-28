/**
 * Fila dos trabalhos pesados do aparelho (whisper e llama).
 *
 * Duas passadas ao mesmo tempo carregam dois modelos na memoria e disputam os
 * mesmos nucleos. Em aparelho pequeno isso termina de duas formas: a interface
 * travada ou o Android encerrando o processo por falta de memoria. Aqui uma
 * passada comeca so quando a anterior termina, e uma acao pedida pelo usuario
 * (analise/revisao) passa na frente de uma transcricao longa que ainda espera.
 *
 * O modulo e puro: nao conhece os motores, so a ordem e os ganchos de pausa e
 * de liberacao de contexto que eles registram.
 */

export type HeavyKind = 'transcription' | 'analysis' | 'review';

export type EngineKind = 'whisper' | 'llama';

export interface HeavyLease {
  release(): void;
}

interface Waiter {
  kind: HeavyKind;
  resolve(lease: HeavyLease): void;
}

let busy = false;
const waiting: Waiter[] = [];
const pauseHooks = new Set<() => void>();
const engineReleasers = new Map<EngineKind, () => Promise<void>>();

function grantNext(): void {
  if (busy) return;
  // Interativo fura a fila: uma transcricao automatica longa nao pode segurar
  // uma analise que o usuario acabou de pedir.
  const interactive = waiting.findIndex((waiter) => waiter.kind !== 'transcription');
  const index = interactive >= 0 ? interactive : 0;
  const next = waiting.splice(index, 1)[0];
  if (!next) return;
  busy = true;
  let released = false;
  next.resolve({
    release() {
      if (released) return;
      released = true;
      busy = false;
      grantNext();
    },
  });
}

/**
 * Espera a vez de um trabalho pesado. `analysis` e `review` pausam antes as
 * transcricoes em andamento; a transcricao apenas espera a vez.
 */
export function acquireHeavyWork(kind: HeavyKind): Promise<HeavyLease> {
  if (kind !== 'transcription') {
    for (const pause of pauseHooks) {
      try {
        pause();
      } catch {
        // um gancho quebrado nao pode travar a fila
      }
    }
  }
  return new Promise((resolve) => {
    waiting.push({ kind, resolve });
    grantNext();
  });
}

/**
 * Registra como parar as transcricoes que estiverem rodando. Devolve a funcao
 * que remove o gancho (usada pelos testes).
 */
export function registerTranscriptionPause(hook: () => void): () => void {
  pauseHooks.add(hook);
  return () => pauseHooks.delete(hook);
}

/** Registra como liberar o modelo nativo de um motor. */
export function registerEngineReleaser(
  engine: EngineKind,
  release: () => Promise<void>,
): void {
  engineReleasers.set(engine, release);
}

/**
 * Libera o modelo do outro motor antes de carregar este. E o limite que evita
 * whisper e llama residentes ao mesmo tempo — juntos eles passam do que um
 * aparelho pequeno suporta em segundo plano.
 */
export async function reserveEngine(engine: EngineKind): Promise<void> {
  for (const [name, release] of engineReleasers) {
    if (name === engine) continue;
    try {
      await release();
    } catch {
      // contexto ja liberado: seguir e o correto
    }
  }
}

/** Para os testes: a fila nasce vazia em cada suite. */
export function resetHeavyWorkForTests(): void {
  busy = false;
  waiting.splice(0);
  pauseHooks.clear();
  engineReleasers.clear();
}
