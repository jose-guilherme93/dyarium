/**
 * Envio automatico do cofre: debounced depois de uma mudanca local e ao voltar
 * ao primeiro plano.
 *
 * O envio automatico nunca apaga e nunca substitui: ele le o retrato, aplica a
 * uniao e grava. Uma falha de rede ou uma sessao vencida so interrompe o envio;
 * o cache local fica intacto e o banner de sessao continua visivel.
 */

import { AppState } from 'react-native';

import { driveSessionState, loadDriveSession } from './driveAuth';
import { openDriveVault, type VaultOpenResult } from './driveVault';
import { onLocalChange } from './localChange';

/** Uma pausa curta para uma rajada de autosave virar um envio so. */
const DEBOUNCE_MS = 2500;

type Listener = (result: VaultOpenResult) => void;

const listeners = new Set<Listener>();
let timer: ReturnType<typeof setTimeout> | null = null;
let current: Promise<void> | null = null;
let pending = false;
let pendingApply = false;
let paused = false;
let started = false;

/** Avisa quem mostra o resumo do Drive que um envio automatico terminou. */
export function onDriveAutoSync(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(result: VaultOpenResult): void {
  for (const listener of [...listeners]) {
    try {
      listener(result);
    } catch {
      // Um ouvinte quebrado nao derruba o envio.
    }
  }
}

async function run(apply: boolean): Promise<void> {
  pending = false;
  await loadDriveSession();
  if (driveSessionState() !== 'connected') return;
  let result: VaultOpenResult;
  try {
    result = await openDriveVault({ apply });
  } catch {
    // Sessao vencida ja atualizou o estado do Drive; falha de rede espera a
    // proxima mudanca. Nada e apagado e o cache local continua valendo.
    return;
  }
  notify(result);
}

async function drain(): Promise<void> {
  if (current) return current;
  const apply = pendingApply;
  pendingApply = false;
  current = (async () => {
    if (pending) await run(apply);
  })().finally(() => {
    current = null;
    if (pending && !paused) void drain();
  });
  return current;
}

/** Agenda um envio. `apply` tambem aplica o retrato remoto (boot/primeiro plano). */
export function scheduleDriveSync(apply = false, delay = DEBOUNCE_MS): void {
  if (paused) return;
  pending = true;
  pendingApply = pendingApply || apply;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void drain();
  }, delay);
}

function cancelTimer(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

/** Para o envio automatico enquanto a conta esta sendo encerrada. */
export async function pauseDriveAutoSync(): Promise<void> {
  paused = true;
  cancelTimer();
  if (current) await current.catch(() => undefined);
}

export function resumeDriveAutoSync(): void {
  paused = false;
}

/**
 * Liga o sinal local e o retorno ao primeiro plano. Chamar mais de uma vez e
 * inofensivo; o app chama no layout raiz.
 */
export function startDriveAutoSync(): () => void {
  if (started) return () => undefined;
  started = true;
  const offLocal = onLocalChange(() => scheduleDriveSync(false));
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') scheduleDriveSync(true, 0);
  });
  if (AppState.currentState === 'active') scheduleDriveSync(true, 0);
  return () => {
    offLocal();
    subscription.remove();
    cancelTimer();
    started = false;
  };
}
