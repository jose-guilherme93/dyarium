/**
 * Atividades pesadas em andamento no aparelho: transcricao, analise, backup,
 * restauracao e download de modelo. O estado vive so em memoria, porque e um
 * aviso em tempo real: o que precisa sobreviver ja esta no SQLite ou no disco.
 */

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
  action?: ActivityAction;
}

export interface StartActivityInput {
  id: string;
  kind: ActivityKind;
  title: string;
  detail?: string;
  progress?: number;
  action?: ActivityAction;
}

export interface ActivityPatch {
  title?: string;
  detail?: string;
  /** `null` limpa a barra (trabalho sem total conhecido). */
  progress?: number | null;
}

/** Teto de memoria: o centro e um resumo recente, nao um historico eterno. */
const MAX_ACTIVITIES = 20;

const activities = new Map<string, Activity>();
const listeners = new Set<() => void>();
let snapshot: Activity[] = [];

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
  while (activities.size > MAX_ACTIVITIES) {
    let oldest: Activity | undefined;
    for (const item of activities.values()) {
      if (item.status === 'running') continue;
      if (!oldest || item.startedAt < oldest.startedAt) oldest = item;
    }
    if (!oldest) return;
    activities.delete(oldest.id);
  }
}

function emit(): void {
  prune();
  snapshot = sortActivities([...activities.values()]);
  for (const listener of [...listeners]) listener();
}

/** Comeca (ou reinicia, com o mesmo id) uma atividade. */
export function startActivity(input: StartActivityInput): void {
  activities.set(input.id, {
    id: input.id,
    kind: input.kind,
    title: input.title,
    detail: input.detail,
    status: 'running',
    progress: normalizeProgress(input.progress),
    startedAt: Date.now(),
    seen: true,
    action: input.action,
  });
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
  emit();
}

function settle(id: string, status: ActivityStatus, detail?: string): void {
  const current = activities.get(id);
  if (!current || current.status !== 'running') return;
  activities.set(id, {
    ...current,
    status,
    detail: detail ?? current.detail,
    progress: current.progress,
    finishedAt: Date.now(),
    seen: false,
  });
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
  if (changed) emit();
}

/** Remove as concluidas mantendo o que ainda esta rodando. */
export function clearFinishedActivities(): void {
  let changed = false;
  for (const [id, item] of activities) {
    if (item.status === 'running') continue;
    activities.delete(id);
    changed = true;
  }
  if (changed) emit();
}

/** Remove uma atividade especifica (usado pelos testes e por uma dispensa futura). */
export function dismissActivity(id: string): void {
  if (activities.delete(id)) emit();
}

export function getActivitiesSnapshot(): Activity[] {
  return snapshot;
}

export function subscribeActivities(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
