import { useEffect, useState } from "react";
import { api } from "../api";
import {
  parseProjectLogs,
  type LogItem,
  type LogSession,
} from "../../../mobile/src/core/projetoLog";
import type { Entry, Note } from "../types";

/**
 * Carga compartilhada do caderno de projetos (MCP): lista da sidebar e
 * superficie de projetos leem o MESMO indice, construido uma unica vez por
 * (notebook, refreshKey). O App chama o hook e passa o resultado para os
 * dois lados; assim nao ha duas buscas em paralelo pelos mesmos dados.
 */

/** Linha da tabela/cartao: um item de sessao amarrado a entry do caderno. */
export interface ItemRow extends LogItem {
  entryId: string | null;
  host?: string;
}

export interface SessionRow {
  session: LogSession;
  entryId: string | null;
}

/** Uma linha da aba Projetos, amarrada a entry: titulo e identidade, icone. */
export interface ProjectAgg {
  project: string;
  entryId: string;
  /** Icone persistido na entry (escolha local da sessao vence este). */
  icon: string;
  sessions: SessionRow[];
}

export interface ProjectsIndex {
  rows: ItemRow[];
  sessions: SessionRow[];
  entries: Entry[];
  entryByProject: Record<string, string>;
  kinds: string[];
}

const KIND_ORDER = ["feat", "fix", "perf", "test", "docs", "chore"];

function newerFirst(a: { date: string; time: string }, b: { date: string; time: string }): number {
  const key = (one: { date: string; time: string }) => `${one.date}T${one.time}`;
  if (key(a) !== key(b)) return key(a) > key(b) ? -1 : 1;
  return 0;
}

/** Constroi o indice uma vez por (notebook, notas): parsing so no modulo puro. */
export function buildIndex(entries: Entry[], noteLists: Note[][]): ProjectsIndex {
  const noteBodies: Array<{ id: string; body: string }> = [];
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
      if (entry?.title) projectByNoteId[note.id] = entry.title;
    });
  });

  const parsed = parseProjectLogs(noteBodies, projectByNoteId);
  const sessions: SessionRow[] = parsed.map((session) => ({
    entryId: entryByProject[session.project] ?? null,
    session,
  }));
  const rows: ItemRow[] = [];
  sessions.forEach((row) => {
    row.session.items.forEach((item) => {
      rows.push({ ...item, entryId: row.entryId, host: row.session.host });
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

  return { rows, sessions, entries, entryByProject, kinds };
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
