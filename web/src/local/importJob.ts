/**
 * Importacao de um servidor em segundo plano.
 *
 * O dialogo so entrega endereco e token e some; a tarefa continua aqui, fora do
 * React, e a faixa da area das notas conta o progresso. Uma tarefa por vez:
 * pedir de novo enquanto a anterior roda nao duplica o trabalho nem as
 * escritas no cofre.
 */

import { diagnoseSource } from "./diagnose";
import { flushVaultSync } from "./folderSync";
import { importEntries, type ImportResult } from "./import";
import { serverSource } from "./serverSource";

export type ImportJobState =
  | { status: "idle" }
  | { status: "running"; done: number; total: number }
  | { status: "done"; result: ImportResult }
  | { status: "error"; message: string };

/** O cofre ja esta no navegador: a copia no Drive pode esperar a poeira baixar. */
const FLUSH_DELAY_MS = 5000;
/** O resumo fica na faixa tempo de ser lido, e some sozinho. */
const DONE_HOLD_MS = 8000;
/** Sem nenhuma nota nova por este tempo, a tarefa esta presa e precisa acabar. */
const PARADO_MS = 3 * 60_000;

let estado: ImportJobState = { status: "idle" };
const ouvintes = new Set<() => void>();
let flushTimer: number | null = null;
let doneTimer: number | null = null;
/**
 * Qual execucao ainda pode escrever no estado. Uma tarefa encerrada (pelo vigia
 * ou por `dismissImportJob`) deixa de ser dona: a requisicao pendente continua
 * na rede, mas nao ressuscita a faixa nem sobrescreve a importacao seguinte.
 */
let ativa: number | null = null;
let geracao = 0;
let vigiaTimer: number | null = null;

export function importJobState(): ImportJobState {
  return estado;
}

export function subscribeImportJob(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

function anunciar(): void {
  // Copia antes de avisar: um ouvinte pode se desinscrever no meio.
  for (const ouvinte of [...ouvintes]) {
    try {
      ouvinte();
    } catch {
      // Ouvinte quebrado nao derruba a importacao nem os outros ouvintes.
    }
  }
}

function definir(proximo: ImportJobState): void {
  estado = proximo;
  anunciar();
}

/**
 * Esconde o resultado ou o erro da faixa.
 *
 * Numa tarefa presa isso tambem encerra o estado e libera a trava para uma nova
 * importacao: a requisicao pendente e abandonada, nao cancelada — nao ha como
 * fechar a rede daqui, e o que ja entrou no cofre ficou salvo.
 */
export function dismissImportJob(): void {
  if (doneTimer !== null) {
    window.clearTimeout(doneTimer);
    doneTimer = null;
  }
  const presa = estado.status === "running";
  ativa = null;
  pararVigia();
  if (estado.status !== "idle") definir({ status: "idle" });
  if (presa) agendarFlush();
}

function agendarFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    // Sem pasta ou sem sessao o sync so termina; o cofre local nao depende dele.
    void flushVaultSync().catch(() => undefined);
  }, FLUSH_DELAY_MS);
}

function pararVigia(): void {
  if (vigiaTimer !== null) {
    window.clearTimeout(vigiaTimer);
    vigiaTimer = null;
  }
}

/**
 * Recomeça a contagem do silencio. Qualquer nota concluida adia o prazo; se
 * nenhuma chegar em 3 min, `terminar` fecha a tarefa com a nota onde parou.
 */
function armarVigia(gen: number): void {
  pararVigia();
  vigiaTimer = window.setTimeout(() => {
    vigiaTimer = null;
    if (ativa !== gen || estado.status !== "running") return;
    const { done, total } = estado;
    terminar(gen, {
      status: "error",
      message: `a importacao parou na nota ${done} de ${total}; o que entrou ficou salvo`,
    });
  }, PARADO_MS);
}

function terminar(gen: number, final: ImportJobState): void {
  // Tarefa ja abandonada: a resposta tardia nao mexe na faixa nem no sync.
  if (ativa !== gen) return;
  ativa = null;
  pararVigia();
  definir(final);
  agendarFlush();
  if (final.status !== "done") return;
  doneTimer = window.setTimeout(() => {
    doneTimer = null;
    // So limpa se nada novo chegou no meio do caminho.
    if (estado === final) definir({ status: "idle" });
  }, DONE_HOLD_MS);
}

/** Tira da mensagem o que nao pode aparecer na tela: token e endereco. */
function semSegredo(mensagem: string, endereco: string, token: string): string {
  let texto = mensagem;
  const trocas: [string, string][] = [
    [token, "token"],
    [endereco.trim(), "servidor"],
    [endereco, "servidor"],
  ];
  for (const [segredo, troca] of trocas) {
    if (segredo.length >= 3) texto = texto.split(segredo).join(troca);
  }
  return texto.trim();
}

async function executar(gen: number, endereco: string, token: string): Promise<void> {
  try {
    // Um NetworkError do navegador pode ser quatro coisas; o diagnostico ja
    // separa todas e a faixa mostra a causa acionavel em uma linha.
    const check = await diagnoseSource(endereco);
    if (ativa !== gen) return;
    if (!check.ok) {
      terminar(gen, { status: "error", message: check.hint });
      return;
    }
    const result = await importEntries(serverSource(endereco, token), (progresso) => {
      if (ativa !== gen) return;
      definir({ status: "running", done: progresso.done, total: progresso.total });
      armarVigia(gen);
    });
    terminar(gen, { status: "done", result });
  } catch (erro) {
    const bruto = erro instanceof Error ? erro.message : String(erro);
    terminar(gen, {
      status: "error",
      message: semSegredo(bruto, endereco, token) || "falha ao importar",
    });
  }
}

/** Entrega a importacao e volta na hora: o dialogo some, a faixa continua. */
export function startServerImport(endereco: string, token: string): void {
  if (estado.status === "running") return;
  if (doneTimer !== null) {
    window.clearTimeout(doneTimer);
    doneTimer = null;
  }
  geracao += 1;
  ativa = geracao;
  definir({ status: "running", done: 0, total: 0 });
  armarVigia(geracao);
  void executar(geracao, endereco, token);
}
