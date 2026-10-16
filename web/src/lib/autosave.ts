// Fila de autosave do corpo da nota. Agrupa edicoes rapidas (debounce),
// serializa as gravacoes para que duas nunca disputem (o que criava notas
// duplicadas) e pode ser esvaziada ao sair da nota ou esconder a pagina, para
// nao perder a ultima digitacao.

export interface Autosave {
  /** Agenda a gravacao do valor mais recente, substituindo o pendente. */
  schedule(value: unknown): void;
  /** Grava agora o pendente (se houver) e resolve quando tudo terminou. */
  flush(): Promise<void>;
  /** Desiste do que esta pendente sem gravar. */
  cancel(): void;
}

/**
 * `save` recebe sempre o valor mais recente e nao deve rejeitar: trate e reporte
 * o erro dentro dela. A fila garante que uma gravacao so comeca quando a
 * anterior terminou e que mudancas feitas durante uma gravacao sao gravadas em
 * seguida, sem perder a ultima.
 */
export function createAutosave(
  save: (value: unknown) => Promise<void>,
  delayMs = 800,
): Autosave {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest: unknown;
  let pending = false;
  let chain: Promise<void> = Promise.resolve();

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const drain = (): Promise<void> => {
    if (!pending) {
      return chain;
    }
    const value = latest;
    pending = false;
    clearTimer();
    chain = chain.then(async () => {
      try {
        await save(value);
      } catch {
        // `save` reporta o erro no proprio fluxo; nao deixe a fila travar.
      }
    });
    return chain;
  };

  return {
    schedule(value: unknown) {
      latest = value;
      pending = true;
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        void drain();
      }, delayMs);
    },
    flush() {
      clearTimer();
      return drain();
    },
    cancel() {
      clearTimer();
      pending = false;
    },
  };
}
