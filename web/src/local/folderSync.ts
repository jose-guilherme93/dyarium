/**
 * Backup automatico do cofre na pasta escolhida.
 *
 * O plano do layout so escreve o que mudou, entao sincronizar de novo e barato
 * quando nada mudou. Ainda assim a chamada e adiada: cada refresh da tela marca
 * o cofre como sujo e o trabalho espera dois minutos de silencio, mais o
 * fechamento da aba. Sem pasta escolhida (ou sem permissao), nada acontece.
 */

import { rememberFolder, type FolderLike } from "./folder";
import { planVaultLayout, readVaultManifest, writeVaultLayout } from "./vaultLayout";

const LAST_KEY = "dyarium.vault.lastSync";
const SILENCE_MS = 2 * 60 * 1000;
const MAX_WAIT_MS = 15 * 60 * 1000;

export interface SyncResult {
  written: number;
  deleted: number;
  unchanged: number;
  at: string;
}

let timer: number | null = null;
/** Ha escrita desde o ultimo backup bem-sucedido. */
let dirty = false;
let primeiraSujeira = 0;
let emAndamento: Promise<SyncResult | null> | null = null;
let ultimo: SyncResult | null = null;

function agora(): string {
  return new Date().toISOString();
}

/** Mensagem para a tela; nao inclui segredo nem caminho do sistema. */
export function lastSyncSummary(): SyncResult | null {
  if (ultimo) return ultimo;
  try {
    const bruto = localStorage.getItem(LAST_KEY);
    if (!bruto) return null;
    const guardado = JSON.parse(bruto) as SyncResult;
    return typeof guardado?.at === "string" ? guardado : null;
  } catch {
    return null;
  }
}

function limparTimer(): void {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
}

/**
 * Uma escrita aconteceu. Se ja houver um backup marcado, mantem o prazo que ja
 * existe; senao, agenda para daqui a dois minutos.
 */
export function markVaultDirty(): void {
  if (typeof window === "undefined") return;
  const jaEstava = dirty;
  dirty = true;
  if (!jaEstava) primeiraSujeira = Date.now();
  // Mudanca esperando ha muito tempo nao pode ficar para tras por causa de
  // refresh continuo: nesse caso grava agora.
  if (Date.now() - primeiraSujeira >= MAX_WAIT_MS) {
    limparTimer();
    void runVaultSync();
    return;
  }
  if (timer !== null) return;
  timer = window.setTimeout(() => {
    timer = null;
    void runVaultSync();
  }, SILENCE_MS);
}

/** Grava o cofre agora, se houver pasta lembrada e algo pendente. */
export async function runVaultSync(folder?: FolderLike | null): Promise<SyncResult | null> {
  if (emAndamento) return emAndamento;
  const alvo = folder ?? (await rememberFolder());
  if (!alvo) return null;

  emAndamento = (async () => {
    try {
      const previous = await readVaultManifest(alvo);
      const plan = await planVaultLayout(previous);
      if (plan.writes.length === 0 && plan.deletes.length === 0) {
        dirty = false;
        limparTimer();
        return { written: 0, deleted: 0, unchanged: plan.unchanged, at: agora() };
      }
      await writeVaultLayout(alvo, plan);
      const result: SyncResult = {
        written: plan.writes.length,
        deleted: plan.deletes.length,
        unchanged: plan.unchanged,
        at: agora(),
      };
      dirty = false;
      primeiraSujeira = 0;
      ultimo = result;
      try {
        localStorage.setItem(LAST_KEY, JSON.stringify(result));
      } catch {
        // sem localStorage o resumo vive so nesta sessao
      }
      limparTimer();
      return result;
    } catch (error) {
      // Falhou: o cofre continua sujo e nova tentativa entra no proximo prazo.
      dirty = true;
      if (timer === null) {
        timer = window.setTimeout(() => {
          timer = null;
          void runVaultSync();
        }, SILENCE_MS);
      }
      throw error;
    } finally {
      emAndamento = null;
    }
  })();

  return emAndamento;
}
