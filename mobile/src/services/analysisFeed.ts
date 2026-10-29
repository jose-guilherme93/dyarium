/**
 * Aviso interno de "analise nova no banco".
 *
 * O sync do servidor busca e guarda a analise; a nota aberta so precisa saber
 * que a copia local mudou para reler o banco. Nenhum texto, titulo ou segredo
 * passa por aqui: so o id da entrada.
 */

type Listener = (entryId: string) => void;

const listeners = new Set<Listener>();

export function subscribeAnalysis(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitAnalysis(entryId: string): void {
  if (entryId === '') return;
  for (const listener of listeners) {
    try {
      listener(entryId);
    } catch {
      // Um ouvinte quebrado nao pode interromper o sync dos outros.
    }
  }
}
