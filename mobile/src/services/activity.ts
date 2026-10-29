/**
 * Atividades pesadas em andamento no aparelho: transcricao, analise, backup,
 * restauracao e download de modelo. O que esta rodando vive em memoria (as
 * acoes sao funcoes); o historico tambem vai para o SQLite, para o centro de
 * atividade nao esquecer o que terminou quando o app reabre.
 */

import {
  deleteActivityRow,
  deleteFinishedActivityRows,
  listActivityRows,
  markActivityRowsSeen,
  pruneActivityRows,
  saveActivityRow,
} from './db';

export type ActivityKind =
  | 'transcription'
  | 'analysis'
  | 'backup'
  | 'restore'
  | 'download';

export type ActivityStatus = 'running' | 'done' | 'error' | 'cancelled';

/** O que fazer depois de uma falha ou interrupcao (tentar de novo, abrir...). */
export interface ActivityAction {
  label: string;
  run(): void | Promise<unknown>;
}

export interface Activity {
  id: string;
  kind: ActivityKind;
  title: string;
  detail?: string;
  status: ActivityStatus;
  /** 0..100; ausente quando o trabalho nao tem total conhecido. */
  progress?: number;
  startedAt: number;
  finishedAt?: number;
  /** Uma atividade concluida so vira "novidade" depois de finalizada. */
  seen: boolean;
  /** O que fazer depois de uma falha ou interrupcao. */
  action?: ActivityAction;
  /** Para o que ainda esta rodando (aparece como botao no centro). */
  stop?: ActivityAction;
}

export interface StartActivityInput {
  id: string;
  kind: ActivityKind;
  title: string;
  detail?: string;
  progress?: number;
  action?: ActivityAction;
  stop?: ActivityAction;
}

export interface ActivityPatch {
  title?: string;
  detail?: string;
  /** `null` limpa a barra (trabalho sem total conhecido). */
  progress?: number | null;
}

/**
 * Teto do historico. O centro e um resumo recente, nao um diario eterno; o
 * limite vale para a memoria e para o SQLite.
 */
const MAX_ACTIVITIES = 50;
/** Detalhe/progresso mudam a cada token: grava no banco no maximo uma vez por segundo. */
const PERSIST_THROTTLE_MS = 1000;

const activities = new Map<string, Activity>();
const listeners = new Set<() => void>();
const lastPersistAt = new Map<string, number>();
let snapshot: Activity[] = [];

const KINDS: ActivityKind[] = ['transcription', 'analysis', 'backup', 'restore', 'download'];
const STATUSES: ActivityStatus[] = ['running', 'done', 'error', 'cancelled'];

/** Grava o historico no SQLite. Best-effort: a interface nao espera o disco. */
function persist(item: Activity, force: boolean): void {
  const now = Date.now();
  if (!force && now - (lastPersistAt.get(item.id) ?? 0) < PERSIST_THROTTLE_MS) return;
  lastPersistAt.set(item.id, now);
  void saveActivityRow({
    id: item.id,
    kind: item.kind,
    title: item.title,
    detail: item.detail ?? null,
    status: item.status,
    progress: item.progress ?? null,
    startedAt: item.startedAt,
    finishedAt: item.finishedAt ?? null,
    seen: item.seen ? 1 : 0,
  }).catch(() => undefined);
}

function normalizeProgress(value: number | null | undefined): number | undefined {
  if (value === null || value === undefined || Number.isNaN(value)) return undefined;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function sortActivities(list: Activity[]): Activity[] {
  return list.sort((a, b) => {
    const aRunning = a.status === 'running';
    const bRunning = b.status === 'running';
    if (aRunning !== bRunning) return aRunning ? -1 : 1;
    return b.startedAt - a.startedAt;
  });
}

function prune(): void {
  const removed: string[] = [];
  while (activities.size > MAX_ACTIVITIES) {
    let oldest: Activity | undefined;
    for (const item of activities.values()) {
      if (item.status === 'running') continue;
      if (!oldest || item.startedAt < oldest.startedAt) oldest = item;
    }
    if (!oldest) break;
    activities.delete(oldest.id);
    removed.push(oldest.id);
  }
  for (const id of removed) void deleteActivityRow(id).catch(() => undefined);
}

function emit(): void {
  prune();
  snapshot = sortActivities([...activities.values()]);
  for (const listener of [...listeners]) listener();
}

/** Comeca (ou reinicia, com o mesmo id) uma atividade. */
export function startActivity(input: StartActivityInput): void {
  const item: Activity = {
    id: input.id,
    kind: input.kind,
    title: input.title,
    detail: input.detail,
    status: 'running',
    progress: normalizeProgress(input.progress),
    startedAt: Date.now(),
    seen: true,
    action: input.action,
    stop: input.stop,
  };
  activities.set(item.id, item);
  persist(item, true);
  void pruneActivityRows(MAX_ACTIVITIES).catch(() => undefined);
  emit();
}

/** Atualiza o texto e/ou a barra de uma atividade que ja esta rodando. */
export function updateActivity(id: string, patch: ActivityPatch): void {
  const current = activities.get(id);
  if (!current || current.status !== 'running') return;

  const next: Activity = {
    ...current,
    title: patch.title ?? current.title,
    detail: patch.detail === undefined ? current.detail : patch.detail,
    progress:
      patch.progress === undefined ? current.progress : normalizeProgress(patch.progress),
  };
  if (
    next.title === current.title &&
    next.detail === current.detail &&
    next.progress === current.progress
  ) {
    return;
  }

  activities.set(id, next);
  persist(next, false);
  emit();
}

function settle(id: string, status: ActivityStatus, detail?: string): void {
  const current = activities.get(id);
  if (!current || current.status !== 'running') return;
  const next: Activity = {
    ...current,
    status,
    detail: detail ?? current.detail,
    progress: current.progress,
    finishedAt: Date.now(),
    seen: false,
  };
  activities.set(id, next);
  persist(next, true);
  emit();
}

export function finishActivity(id: string, detail?: string): void {
  settle(id, 'done', detail);
}

export function failActivity(id: string, detail?: string): void {
  settle(id, 'error', detail);
}

export function cancelActivity(id: string, detail?: string): void {
  settle(id, 'cancelled', detail);
}

/** Marca as concluidas como vistas (ao abrir o centro). */
export function markActivitiesSeen(): void {
  let changed = false;
  for (const [id, item] of activities) {
    if (item.status === 'running' || item.seen) continue;
    activities.set(id, { ...item, seen: true });
    changed = true;
  }
  if (changed) {
    void markActivityRowsSeen().catch(() => undefined);
    emit();
  }
}

/** Remove as concluidas mantendo o que ainda esta rodando. */
export function clearFinishedActivities(): void {
  let changed = false;
  for (const [id, item] of activities) {
    if (item.status === 'running') continue;
    activities.delete(id);
    changed = true;
  }
  if (changed) {
    void deleteFinishedActivityRows().catch(() => undefined);
    emit();
  }
}

/** Remove uma atividade especifica (usado pelos testes e por uma dispensa futura). */
export function dismissActivity(id: string): void {
  if (activities.delete(id)) {
    void deleteActivityRow(id).catch(() => undefined);
    emit();
  }
}

/** Para onde uma atividade concluida leva o usuario. */
export interface ActivityDestination {
  screen: 'note' | 'transcript' | 'backup' | 'models';
  /** Nota da atividade (para nota e transcricao). */
  noteId?: string;
}

/**
 * Destino de uma atividade. O id carrega o tipo e a nota (`analysis:<nota>`,
 * `transcription:<nota>`, `review:<nota>`), entao o destino sobrevive ao
 * restart do app sem coluna nova no banco.
 */
export function activityDestination(item: Activity): ActivityDestination | null {
  const separator = item.id.indexOf(':');
  const prefix = separator >= 0 ? item.id.slice(0, separator) : item.id;
  const rest = separator >= 0 ? item.id.slice(separator + 1) : '';
  if (item.kind === 'transcription' && prefix === 'transcription' && rest !== '') {
    return { screen: 'transcript', noteId: rest };
  }
  if (item.kind === 'analysis') {
    if (prefix === 'review' && rest !== '') return { screen: 'transcript', noteId: rest };
    if (prefix === 'analysis' && rest !== '') return { screen: 'note', noteId: rest };
  }
  if (item.kind === 'backup' || item.kind === 'restore') return { screen: 'backup' };
  if (item.kind === 'download') return { screen: 'models' };
  return null;
}

export function getActivitiesSnapshot(): Activity[] {
  return snapshot;
}

/**
 * Carrega o historico salvo. Uma atividade que ficou `running` no banco morreu
 * com o processo anterior: vira "interrompida", nunca "concluida".
 */
let hydration: Promise<void> | null = null;

export function loadStoredActivities(): Promise<void> {
  hydration ??= hydrate();
  return hydration;
}

async function hydrate(): Promise<void> {
  let rows: Awaited<ReturnType<typeof listActivityRows>> = [];
  try {
    rows = await listActivityRows(MAX_ACTIVITIES);
  } catch {
    return;
  }
  for (const row of rows) {
    if (activities.has(row.id)) continue;
    if (!KINDS.includes(row.kind as ActivityKind)) continue;
    if (!STATUSES.includes(row.status as ActivityStatus)) continue;
    const interrupted = row.status === 'running';
    const item: Activity = {
      id: row.id,
      kind: row.kind as ActivityKind,
      title: row.title,
      detail: interrupted ? 'Interrompida' : row.detail ?? undefined,
      status: interrupted ? 'cancelled' : (row.status as ActivityStatus),
      progress: row.progress ?? undefined,
      startedAt: row.startedAt,
      finishedAt: interrupted ? row.finishedAt ?? Date.now() : row.finishedAt ?? undefined,
      seen: interrupted ? false : row.seen === 1,
    };
    activities.set(item.id, item);
    if (interrupted) persist(item, true);
  }
  emit();
}

export function subscribeActivities(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
