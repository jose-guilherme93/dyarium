import { useEffect, useState } from "react";
import { api } from "../api";
import {
  buildProjectTree,
  folderAggregate,
  parseProjectLogs,
  type FolderAggregate,
  type LogItem,
  type LogSession,
  type ProjectTree,
  type ProjectTreeSessionNode,
  type SessionNote,
} from "../../../mobile/src/core/projetoLog";
import type { Entry, Note } from "../types";

/**
 * Carga compartilhada do caderno de projetos (MCP): a arvore da sidebar e a
 * superficie de projetos leem o MESMO indice, construido uma unica vez por
 * (notebook, refreshKey). O App chama o hook e passa o resultado para os dois
 * lados; assim nao ha duas buscas em paralelo pelos mesmos dados.
 *
 * O indice cobre as duas leituras do caderno (docs/projetos.md): o parseador
 * compartilhado (mobile/src/core/projetoLog) da as sessoes de fence v2 em
 * arvore (maquina + caminho) e as notas v1/legadas em linhas de itens.
 */

/** Linha da tabela/cartao: um item de sessao amarrado a entry e a nota. */
export interface ItemRow extends LogItem {
  entryId: string | null;
  noteId: string;
  host?: string;
}

export interface SessionRow {
  session: LogSession;
  entryId: string | null;
  noteId: string;
}

/** Uma linha de projeto v1, amarrada a entry: titulo e identidade, icone. */
export interface ProjectAgg {
  project: string;
  entryId: string;
  /** Icone persistido na entry (escolha local da sessao vence este). */
  icon: string;
  sessions: SessionRow[];
}

/** No de sessao da arvore, com o titulo da nota como nome da sessao. */
export interface PjSessionNode extends ProjectTreeSessionNode {
  /** Nome exibido: titulo da nota; sem titulo, o ultimo segmento do caminho. */
  title: string;
}

export interface PjFolderNode {
  machine: string;
  path: string;
  /** Dois ultimos segmentos do caminho. */
  label: string;
  sessions: PjSessionNode[];
  count: number;
  lastActivity: string;
}

export interface PjMachineNode {
  machine: string;
  count: number;
  folders: PjFolderNode[];
  sessions: PjSessionNode[];
}

export interface PjTree {
  machines: PjMachineNode[];
  /** Todas as sessoes v2, mais novas primeiro. */
  sessions: PjSessionNode[];
  count: number;
}

/** No selecionado na arvore; dirige o escopo da superficie inteira. */
export type ProjectsNode =
  | { kind: "all" }
  | { kind: "machine"; machine: string }
  | { kind: "folder"; machine: string; path: string }
  | { kind: "session"; id: string }
  | { kind: "project"; entryId: string };

export interface ProjectsIndex {
  rows: ItemRow[];
  sessions: SessionRow[];
  entries: Entry[];
  entryByProject: Record<string, string>;
  kinds: string[];
  /** Arvore das sessoes de fence v2 (maquina + caminho). */
  tree: PjTree;
  /** Projects cuja entry nunca teve sessao v2: listam como antes. */
  v1Projects: ProjectAgg[];
}

const KIND_ORDER = ["feat", "fix", "perf", "test", "docs", "chore"];

function newerFirst(a: { date: string; time: string }, b: { date: string; time: string }): number {
  const key = (one: { date: string; time: string }) => `${one.date}T${one.time}`;
  if (key(a) !== key(b)) return key(a) > key(b) ? -1 : 1;
  return 0;
}

/** Mapa sessionId -> nota de origem: o escopo por no da arvore amarra ai. */
function noteIdBySessionId(notes: Note[], projectByNoteId: Record<string, string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const note of notes) {
    if (!note?.id) continue;
    const own = parseProjectLogs(
      [{ id: note.id, body: note.content_markdown ?? "" }],
      { [note.id]: projectByNoteId[note.id] ?? "" },
    );
    for (const session of own) {
      if (!map.has(session.sessionId)) map.set(session.sessionId, note.id);
    }
  }
  return map;
}

function lastSegment(path: string): string {
  const segments = path.split(/[/\\]+/).filter((part) => part !== "");
  return segments.length > 0 ? segments[segments.length - 1] : "";
}

function enrichTree(tree: ProjectTree, noteTitleById: Record<string, string>): PjTree {
  const titleOf = (node: ProjectTreeSessionNode): PjSessionNode => ({
    ...node,
    title: noteTitleById[node.noteId] || lastSegment(node.path) || node.machine,
  });
  const machines: PjMachineNode[] = tree.machines.map((machine) => ({
    machine: machine.machine,
    count: machine.count,
    folders: machine.folders.map((folder) => ({
      machine: folder.machine,
      path: folder.path,
      label: folder.label,
      sessions: folder.sessions.map(titleOf),
      count: folder.count,
      lastActivity: folder.lastActivity,
    })),
    sessions: machine.sessions.map(titleOf),
  }));
  return { machines, sessions: tree.sessions.map(titleOf), count: tree.count };
}

/** Constroi o indice uma vez por (notebook, notas): parsing so no modulo puro. */
export function buildIndex(entries: Entry[], noteLists: Note[][], now?: number): ProjectsIndex {
  const noteBodies: Array<{ id: string; body: string }> = [];
  const noteSources: Note[] = [];
  const noteTitleById: Record<string, string> = {};
  const projectByNoteId: Record<string, string> = {};
  const entryByProject: Record<string, string> = {};

  entries.forEach((entry) => {
    if (entry?.title && entryByProject[entry.title] === undefined) {
      entryByProject[entry.title] = entry.id;
    }
  });
  noteLists.forEach((notes, index) => {
    const entry = entries[index];
    (notes ?? []).forEach((note) => {
      if (!note) return;
      noteBodies.push({ id: note.id, body: note.content_markdown ?? "" });
      noteSources.push(note);
      if (note.title) noteTitleById[note.id] = note.title;
      if (entry?.title) projectByNoteId[note.id] = entry.title;
    });
  });

  const parsed = parseProjectLogs(noteBodies, projectByNoteId);
  const ownerOf = noteIdBySessionId(noteSources, projectByNoteId);
  const sessions: SessionRow[] = parsed.map((session) => ({
    entryId: entryByProject[session.project] ?? null,
    noteId: ownerOf.get(session.sessionId) ?? "",
    session,
  }));
  const rows: ItemRow[] = [];
  sessions.forEach((row) => {
    row.session.items.forEach((item) => {
      rows.push({ ...item, entryId: row.entryId, noteId: row.noteId, host: row.session.host });
    });
  });
  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date > b.date ? -1 : 1;
    return newerFirst({ date: a.date, time: a.time }, { date: b.date, time: b.time });
  });
  sessions.sort((a, b) => newerFirst(a.session, b.session));

  const seen = new Set<string>();
  const kinds = [...KIND_ORDER];
  for (const kind of new Set(rows.map((row) => row.kind))) {
    if (!seen.has(kind) && !KIND_ORDER.includes(kind)) {
      seen.add(kind);
      kinds.push(kind);
    }
  }

  const tree = enrichTree(
    buildProjectTree({
      entries: entries.map((entry) => ({ id: entry.id, title: entry.title })),
      notes: noteSources,
      ...(now === undefined ? {} : { now }),
    }),
    noteTitleById,
  );

  const covered = new Set<string>();
  for (const node of tree.sessions) {
    if (node.entryId) covered.add(node.entryId);
  }
  const v1Projects = entries
    .filter((entry) => Boolean(entry.title))
    .map((entry) => ({
      project: entry.title as string,
      entryId: entry.id,
      icon: entry.icon ?? "",
      sessions: sessions.filter((row) => row.session.project === entry.title),
    }))
    .filter((agg) => !covered.has(agg.entryId));

  return { rows, sessions, entries, entryByProject, kinds, tree, v1Projects };
}

/** Linhas por projeto, na ordem das entries; sessoes juntas por project name. */
export function aggregate(index: ProjectsIndex): ProjectAgg[] {
  return index.entries
    .filter((entry) => Boolean(entry.title))
    .map((entry) => ({
      project: entry.title,
      entryId: entry.id,
      icon: entry.icon ?? "",
      sessions: index.sessions.filter((row) => row.session.project === entry.title),
    }));
}

/** No de sessao da arvore pelo id canonico (`machine|path|session`). */
export function findSessionNode(tree: PjTree, id: string): PjSessionNode | null {
  return tree.sessions.find((node) => node.session.id === id) ?? null;
}

/** No de pasta por (maquina, caminho completo). */
export function findFolder(tree: PjTree, machine: string, path: string): PjFolderNode | null {
  for (const node of tree.machines) {
    if (node.machine !== machine) continue;
    return node.folders.find((folder) => folder.path === path) ?? null;
  }
  return null;
}

/** Notas que pertencem ao no; null = sem filtro (Todos). */
export function noteIdsForNode(index: ProjectsIndex, node: ProjectsNode): Set<string> | null {
  switch (node.kind) {
    case "all":
    case "project":
      return null;
    case "machine": {
      const ids = new Set<string>();
      for (const machine of index.tree.machines) {
        if (machine.machine !== node.machine) continue;
        for (const session of machine.sessions) ids.add(session.noteId);
        for (const folder of machine.folders) {
          for (const session of folder.sessions) ids.add(session.noteId);
        }
      }
      return ids;
    }
    case "folder": {
      const found = findFolder(index.tree, node.machine, node.path);
      if (!found) return new Set();
      return new Set(found.sessions.map((session) => session.noteId));
    }
    case "session": {
      const found = findSessionNode(index.tree, node.id);
      if (!found) return new Set();
      return new Set([found.noteId]);
    }
  }
}

/** Itens visiveis sob o no selecionado: a tabela Itens e escopada aqui. */
export function scopeRows(index: ProjectsIndex, node: ProjectsNode): ItemRow[] {
  if (node.kind === "all") return index.rows;
  if (node.kind === "project") return index.rows.filter((row) => row.entryId === node.entryId);
  const noteIds = noteIdsForNode(index, node);
  if (!noteIds) return index.rows;
  return index.rows.filter((row) => row.noteId !== "" && noteIds.has(row.noteId));
}

/** Numeros do agregado de uma pasta (leitura do no de pasta). */
export function folderReading(folder: PjFolderNode): FolderAggregate {
  const sessions: SessionNote[] = folder.sessions.map((node) => node.session);
  return folderAggregate(sessions);
}

export interface UseProjectsIndexResult {
  index: ProjectsIndex | null;
  loading: boolean;
  error: string;
}

/**
 * Le entries + notas do caderno MCP e monta o indice. Com notebookId vazio
 * (o caderno aberto nao e de projetos) nao busca nada. Cancelamento local:
 * trocar de caderno no meio da leitura nao pode marcar estado tardiamente.
 */
export function useProjectsIndex(notebookId: string, refreshKey: number): UseProjectsIndexResult {
  const [index, setIndex] = useState<ProjectsIndex | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!notebookId) {
      setLoading(false);
      setIndex(null);
      return;
    }
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const entriesRes = await api.listEntries({ notebook_id: notebookId, limit: 1000 });
        const entries = entriesRes?.entries ?? [];
        const noteLists = await Promise.all(
          entries.map((entry) =>
            api
              .listNotes(entry.id)
              .then((res) => res?.notes ?? [])
              .catch(() => [] as Note[]),
          ),
        );
        if (!active) return;
        setIndex(buildIndex(entries, noteLists));
        setError("");
      } catch (err) {
        if (active) {
          setIndex(null);
          setError(err instanceof Error ? err.message : "falha ao carregar os projetos");
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [notebookId, refreshKey]);

  return { index, loading, error };
}

// Reexportado para as vistas calcularem estado e series sem import duplo.
export type { LogItem, LogSession, SessionNote };
