/**
 * Sinal de mudanca local, sem dependencia de Drive, banco ou React Native.
 *
 * A biblioteca avisa que uma nota, um caderno ou um ajuste mudou; quem escuta
 * decide o que fazer. O Drive usa o sinal para agendar o envio debounced, e o
 * sinal continua barato quando nao ha conta conectada.
 */

const listeners = new Set<() => void>();

/** Registra um ouvinte; devolve a funcao que cancela. */
export function onLocalChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyLocalChange(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // Um ouvinte quebrado nao pode impedir os outros de saber da mudanca.
    }
  }
}
