/**
 * Instancia unica do worker do navegador para o dashboard inteiro.
 *
 * O processamento precisa continuar quando o usuario sai da nota ou do
 * laboratorio; por isso a instancia vive fora dos componentes. Quem mostra o
 * estado assina este store; quem liga/desliga chama start/stop.
 */

import {
  BrowserProcessor,
  loadWorkerSettings,
  type ProcessorState,
} from "./browserProcessor";
import type { BrowserPlan } from "./browserModels";
import type { DeviceIdentity } from "./deviceIdentity";
import { workerApi } from "./workerApi";

type Listener = (state: ProcessorState | null) => void;

let processor: BrowserProcessor | null = null;
let state: ProcessorState | null = null;
let starting: Promise<void> | null = null;
let exitHook = false;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener(state);
}

export function getWorkerState(): ProcessorState | null {
  return state;
}

export function subscribeWorker(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

function isActive(phase: ProcessorState["phase"] | undefined): boolean {
  return phase === "preparing" || phase === "waiting" || phase === "working" || phase === "stopping";
}

/**
 * Liga o worker. Se ele ja esta ativo, devolve quando estiver pronto; durante o
 * primeiro download as duas telas (nota e laboratorio) esperam a mesma promessa
 * em vez de criar dois workers concorrentes.
 */
export async function startWorker(
  plan: BrowserPlan,
  caps: unknown,
  allowGpu: boolean,
  threads = 0,
  device?: DeviceIdentity,
): Promise<void> {
  if (processor && isActive(state?.phase)) {
    if (state?.phase === "preparing" && starting) await starting;
    return;
  }
  if (starting) {
    await starting;
    return;
  }
  starting = (async () => {
    const settings = await loadWorkerSettings();
    const instance = new BrowserProcessor(settings, (next) => {
      state = next;
      notify();
    });
    processor = instance;
    state = instance.snapshot;
    notify();
    if (!exitHook) {
      exitHook = true;
      // Recarregar ou fechar a aba devolve o job na hora. Sem isso, o servidor
      // esperaria o lease de 120 s antes de assumir a nota.
      window.addEventListener("pagehide", () => {
        if (processor && isActive(state?.phase)) {
          workerApi.unregisterOnExit(processor.id);
        }
      });
    }
    await instance.start(plan, caps, { allowGpu, threads, device });
    if (instance.snapshot.phase === "idle" || instance.snapshot.phase === "error") {
      if (processor === instance) processor = null;
    }
  })();
  try {
    await starting;
  } finally {
    starting = null;
  }
}

export async function stopWorker(): Promise<void> {
  const current = processor;
  // Espera o encerramento antes de liberar a instancia: um start imediato nao
  // pode registrar o mesmo worker_id enquanto o antigo ainda se desregistra.
  await current?.stop();
  if (processor === current) processor = null;
  state = null;
  notify();
}

/** Devolve o job em andamento ao servidor e desliga o worker. */
export async function handOffWorker(): Promise<void> {
  const current = processor;
  if (!current) return;
  await current.abandon();
  if (processor === current) processor = null;
  state = null;
  notify();
}

/**
 * Pede que o worker processe esta nota. Retorna false quando o modo local nao
 * esta ligado; nesse caso o clique segue o caminho normal do servidor.
 */
export async function beginWorkerEntry(entryId: string): Promise<boolean> {
  return (await processor?.beginEntry(entryId)) ?? false;
}

/** O pedido nao entrou na fila: desfaz a preferencia local. */
export async function cancelWorkerEntry(entryId: string): Promise<void> {
  await processor?.cancelEntry(entryId);
}

/** O resultado desta nota substitui a analise anterior. */
export function replaceWorkerEntry(entryId: string): void {
  processor?.forceReplace(entryId);
}
