/**
 * Backup automatico do cofre na pasta escolhida.
 *
 * O plano do layout so escreve o que mudou, entao sincronizar de novo e barato
 * quando nada mudou. Ainda assim a chamada e adiada: cada refresh da tela marca
 * o cofre como sujo e o trabalho espera dois minutos de silencio, mais o
 * fechamento da aba. Sem pasta escolhida (ou sem permissao), nada acontece.
 */

import { rememberFolder } from "./folder";
import {
  planVaultLayout,
  readVaultManifest,
  writeVaultLayout,
  type VaultFolderLike,
} from "./vaultLayout";

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
/** Snapshot (key.txt/backup.enc/state.enc) ficou pendente de regravar. */
let snapshotDirty = false;
let primeiraSujeira = 0;
let emAndamento: Promise<SyncResult | null> | null = null;
let ultimo: SyncResult | null = null;
/** Gancho que re-sela os snapshots apos uma escrita do layout. */
let vaultWriteHook: ((folder: VaultFolderLike) => Promise<void>) | null = null;
/**
 * De onde vem a pasta quando ninguem passa uma: o File System Access (pasta
 * lembrada) ou um provedor de nuvem, como a sessao do Drive. O provedor pode
 * devolver null quando nao ha sessao; nesse caso o sync so termina.
 */
let targetProvider: (() => Promise<VaultFolderLike | null>) | null = null;

/** Troca a origem do alvo padrao; `null` volta para a pasta lembrada. */
export function setVaultTarget(
  provider: (() => Promise<VaultFolderLike | null>) | null,
): void {
  targetProvider = provider;
  // Trocar de alvo nao deve carregar sujeira de uma sessao anterior.
  dirty = false;
  snapshotDirty = false;
  primeiraSujeira = 0;
  limparTimer();
}

/** Registra o gancho que re-sela os snapshots apos uma escrita do layout. */
export function setVaultWriteHook(
  hook: ((folder: VaultFolderLike) => Promise<void>) | null,
): void {
  vaultWriteHook = hook;
  dirty = false;
  snapshotDirty = false;
  primeiraSujeira = 0;
  limparTimer();
}

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

/** Ha escrita local esperando o proximo backup. */
export function isVaultDirty(): boolean {
  return dirty;
}

/**
 * Forca a gravacao agora, sem esperar os dois minutos de silencio.
 *
 * Reaproveita a mesma fila do `runVaultSync` (uma escrita por vez) e cancela o
 * timer pendente: quem acabou de importar um cofre nao fica esperando.
 */
export async function flushVaultSync(): Promise<SyncResult | null> {
  limparTimer();
  return runVaultSync();
}

/** Grava o cofre agora, se houver pasta lembrada e algo pendente. */
export function runVaultSync(folder?: VaultFolderLike | null): Promise<SyncResult | null> {
  if (emAndamento) return emAndamento;

  // A fila e reservada antes de qualquer `await`: dois chamadores no mesmo
  // tique (um flush e um timer, por exemplo) veem a mesma escrita.
  const execucao = (async (): Promise<SyncResult | null> => {
    let alvo: VaultFolderLike | null;
    if (folder) {
      alvo = folder;
    } else if (targetProvider) {
      try {
        alvo = await targetProvider();
      } catch {
        // Sem sessao (ou sessao vencida) nao ha o que gravar nem por que reagendar.
        return null;
      }
    } else {
      alvo = await rememberFolder();
    }
    if (!alvo) {
      // Sem destino (nem pasta lembrada, nem sessao do Drive) nao ha o que
      // gravar. Limpar a sujeira evita que a proxima abertura do app agende
      // uma escrita que nunca teria para onde ir.
      dirty = false;
      snapshotDirty = false;
      primeiraSujeira = 0;
      limparTimer();
      return null;
    }

    try {
      const previous = await readVaultManifest(alvo);
      const plan = await planVaultLayout(previous);
      const temMudancaLayout = plan.writes.length > 0 || plan.deletes.length > 0;

      // Escrita do layout so quando ha mudanca: um sync sem mudanca nao toca
      // em arquivo nenhum.
      if (temMudancaLayout) {
        await writeVaultLayout(alvo, plan);
      }

      // Sem mudanca de layout e sem snapshot pendente: nada a fazer alem de
      // limpar a sujeira. O gancho nao roda (nao ha o que re-selar).
      if (!temMudancaLayout && !snapshotDirty) {
        dirty = false;
        snapshotDirty = false;
        limparTimer();
        return { written: 0, deleted: 0, unchanged: plan.unchanged, at: agora() };
      }

      // Re-sela os snapshots quando houve mudanca de layout ou quando um
      // snapshot anterior falhou. Roda dentro da fila (emAndamento), sem
      // sobreposicao.
      if (vaultWriteHook && (temMudancaLayout || snapshotDirty)) {
        try {
          await vaultWriteHook(alvo);
        } catch (error) {
          // Snapshot falhou: o layout pode ter ido, mas o cofre continua sujo
          // e o snapshot fica pendente para a proxima tentativa.
          dirty = true;
          snapshotDirty = true;
          if (timer === null) {
            timer = window.setTimeout(() => {
              timer = null;
              void runVaultSync();
            }, SILENCE_MS);
          }
          throw error;
        }
      }

      const result: SyncResult = temMudancaLayout
        ? {
            written: plan.writes.length,
            deleted: plan.deletes.length,
            unchanged: plan.unchanged,
            at: agora(),
          }
        : { written: 0, deleted: 0, unchanged: plan.unchanged, at: agora() };
      dirty = false;
      snapshotDirty = false;
      primeiraSujeira = 0;
      if (temMudancaLayout) {
        ultimo = result;
        try {
          localStorage.setItem(LAST_KEY, JSON.stringify(result));
        } catch {
          // sem localStorage o resumo vive so nesta sessao
        }
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
    }
  })();

  emAndamento = execucao;
  void execucao.then(
    () => {
      emAndamento = null;
    },
    () => {
      emAndamento = null;
    },
  );
  return execucao;
}
