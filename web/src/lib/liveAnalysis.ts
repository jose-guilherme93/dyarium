/**
 * Analise parcial enquanto o worker da aba le a nota.
 *
 * O painel da nota e o laboratorio assinam este store. Cada bloco lido publica
 * o documento composto ate ali, entao a ficha mostra pessoas, temas e tom na
 * hora, em vez de esperar a nota inteira. O resultado final continua vindo do
 * servidor; este estado e so a ponte visual.
 */

import type { Analysis } from "../types";

export interface LiveAnalysis {
  entryId: string;
  analysis: Analysis;
  read: number;
  total: number;
  /** "reading", "sentence" ou "done". */
  stage: string;
  updatedAt: number;
}

type Listener = (entryId: string, state: LiveAnalysis | null) => void;

const states = new Map<string, LiveAnalysis>();
const listeners = new Set<Listener>();

function notify(entryId: string): void {
  const state = states.get(entryId) ?? null;
  for (const listener of listeners) listener(entryId, state);
}

export function getLiveAnalysis(entryId: string): LiveAnalysis | null {
  return states.get(entryId) ?? null;
}

export function subscribeLiveAnalysis(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setLiveAnalysis(
  entryId: string,
  analysis: Analysis,
  read: number,
  total: number,
  stage = "reading",
): void {
  states.set(entryId, {
    entryId,
    analysis,
    read,
    total,
    stage,
    updatedAt: Date.now(),
  });
  notify(entryId);
}

/** Atualiza so o progresso, preservando o documento ja composto. */
export function updateLiveProgress(
  entryId: string,
  read: number,
  total: number,
  stage: string,
): void {
  const current = states.get(entryId);
  if (!current) return;
  states.set(entryId, { ...current, read, total, stage, updatedAt: Date.now() });
  notify(entryId);
}

/** Fim da passada: o documento parcial fica, mas o spinner some. */
export function finishLiveAnalysis(entryId: string): void {
  const current = states.get(entryId);
  if (!current) return;
  states.set(entryId, { ...current, stage: "done", updatedAt: Date.now() });
  notify(entryId);
}

export function clearLiveAnalysis(entryId: string): void {
  if (!states.delete(entryId)) return;
  notify(entryId);
}
