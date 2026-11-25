/**
 * O que o cofre ainda faz depois de o app aparecer.
 *
 * O login termina quando o retrato de metadados esta aplicado: o sync e as
 * capas seguem atras, sem tela de carregamento. Este estado e o sinal discreto
 * que a linha do Drive mostra e o motivo de uma falha do segundo plano nao
 * derrubar nada — ela volta em uma linha e o app continua utilizavel.
 */

import type { StepProgress } from "./backup";
import type { VaultStage } from "./vaultCloud";

export interface VaultActivityState {
  /** Ha trabalho de segundo plano rodando agora. */
  running: boolean;
  /** Etapa que o `VaultBoot` sabe nomear; vale enquanto `running`. */
  stage: VaultStage;
  /** Contagem do passo atual, quando ele conta item por item. */
  progress: StepProgress | null;
  /** Ultima falha do segundo plano; vazio quando nao falhou. */
  error: string;
}

const INICIAL: VaultActivityState = {
  running: false,
  stage: "sincronizando",
  progress: null,
  error: "",
};

let estado: VaultActivityState = INICIAL;
/** Cada trabalho tem o seu marcador: um trabalho velho nao apaga o novo. */
let geracao = 0;
const ouvintes = new Set<() => void>();

function publicar(proximo: VaultActivityState): void {
  estado = proximo;
  for (const ouvinte of [...ouvintes]) {
    try {
      ouvinte();
    } catch {
      // Um ouvinte quebrado nao pode impedir os outros de ver o estado.
    }
  }
}

export function vaultActivity(): VaultActivityState {
  return estado;
}

export function subscribeVaultActivity(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

/** Comeca um trabalho de segundo plano e devolve o marcador dele. */
export function beginVaultActivity(stage: VaultStage): number {
  geracao += 1;
  publicar({ running: true, stage, progress: null, error: "" });
  return geracao;
}

/** Troca etapa ou contagem; marcador de outro trabalho e ignorado. */
export function updateVaultActivity(
  token: number,
  mudanca: { stage?: VaultStage; progress?: StepProgress | null },
): void {
  if (token !== geracao) return;
  publicar({
    ...estado,
    running: true,
    stage: mudanca.stage ?? estado.stage,
    progress: mudanca.progress === undefined ? estado.progress : mudanca.progress,
  });
}

/** Termina o trabalho; `error` vazio limpa a falha anterior. */
export function endVaultActivity(token: number, error = ""): void {
  if (token !== geracao) return;
  publicar({ ...estado, running: false, progress: null, error });
}

/** Limpa a falha mostrada na linha (o tentar que deu certo). */
export function clearVaultActivityError(): void {
  if (!estado.error) return;
  publicar({ ...estado, error: "" });
}

/** Zera o estado entre sessoes/testes; trabalho em curso perde o marcador. */
export function resetVaultActivity(): void {
  geracao += 1;
  publicar(INICIAL);
}
