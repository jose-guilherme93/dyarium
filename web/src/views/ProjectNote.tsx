import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../api";
import { EmojiPicker } from "../components/EmojiPicker";
import { Spinner } from "../components/Status";
import {
  BookIcon,
  CheckIcon,
  ExternalIcon,
  FilterIcon,
  LinkIcon,
  PencilIcon,
} from "../components/icons";
import {
  itemKindCounts,
  parseProjectLogs,
  type LogItem,
  type LogSession,
} from "../../../mobile/src/core/projetoLog";
import { isNoteCommand, type NoteAction, type NoteActionIcon, type ProjectsRange } from "../lib/actions";
import type { Entry } from "../types";

/**
 * Leitura da nota de um projeto no caderno MCP (docs/projetos.md): o corpo em
 * markdown e parseado pelo modulo projetoLog e vira a superficie do prototipo
 * (proto-resumos.html, aba Nota) - titulo, resumo, um bloco por sessao com a
 * tabela por kind e os botoes de acao declarativos. O fence e o ":::details"
 * nunca aparecem; "Editar" devolve ao editor de markdown de sempre.
 */

interface ProjectNoteProps {
  entryId: string;
  /** Nome do caderno na linha de meta ("Projetos"). */
  notebookName: string;
  /** Muda quando a nota pode ler de novo (voltou da edicao, sincronizou). */
  refreshKey: number;
  /** Aba Itens ja filtrada pelo projeto e pelo periodo da sessao. */
  onFilterItems: (project: string, range: ProjectsRange) => void;
  /** Abre o editor de markdown com o corpo completo. */
  onEdit: () => void;
}

const KIND_ORDER = ["feat", "fix", "perf", "test", "docs", "chore"];
const KIND_CLASS: Record<string, string> = {
  feat: "pj-kc--feat",
  fix: "pj-kc--fix",
  perf: "pj-kc--perf",
  test: "pj-kc--test",
  docs: "pj-kc--muted",
  chore: "pj-kc--muted",
};
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Dia como numero, para comparar datas sem nesta horario. */
function dayNumber(date: string): number {
  const parts = date.split("-").map(Number);
  if (parts.length < 3 || parts.some((part) => Number.isNaN(part))) return Number.NaN;
  return Date.UTC(parts[0], parts[1] - 1, parts[2]) / 864e5;
}

function todayNumber(): number {
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 864e5;
}

/** "9 nov" como no prototipo; entrada vem AAAA-MM-DD. */
function shortDate(date: string): string {
  const day = dayNumber(date);
  if (Number.isNaN(day)) return date;
  const d = new Date(day * 864e5);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Periodo da aba Itens que garante a sessao visivel: 7 dias, 30 dias ou tudo. */
function rangeForDate(date: string): ProjectsRange {
  const day = dayNumber(date);
  if (Number.isNaN(day)) return "all";
  const diff = todayNumber() - day;
  if (diff <= 6) return "7";
  if (diff <= 29) return "30";
  return "all";
}

/** Url do commit mais recente da sessao: item primeiro (ordem do arquivo),
 * depois o bloco tecnico; sem remoto, nada a copiar. */
function newestCommitUrl(session: LogSession): string {
  for (const item of session.items) {
    if (item.url) return item.url;
  }
  for (const commit of session.commits) {
    if (commit.url) return commit.url;
  }
  return "";
}

/** Kinds presentes na sessao, na ordem canonica; desconhecidos depois. */
function kindsOf(items: LogItem[]): string[] {
  const counts = itemKindCounts(items);
  const keys = Object.keys(counts);
  const known = KIND_ORDER.filter((kind) => keys.includes(kind));
  const extra = keys.filter((kind) => !KIND_ORDER.includes(kind));
  return [...known, ...extra];
}

interface PickerSpot {
  current: string;
  anchor: DOMRect;
}

export function ProjectNote({
  entryId,
  notebookName,
  refreshKey,
  onFilterItems,
  onEdit,
}: ProjectNoteProps) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [sessions, setSessions] = useState<LogSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [iconChoice, setIconChoice] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerSpot | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimer = useRef<number | null>(null);

  // Rede sempre: a variante Cached chegou vazias no primeiro acesso do caderno
  // MCP (mesma decisao da superficie de projetos). Cancelamento local: trocar
  // de nota no meio da leitura nao pode marcar estado tardiamente.
  useEffect(() => {
    if (!entryId) {
      setLoading(false);
      setSessions([]);
      return;
    }
    let active = true;
    setLoading(true);
    setIconChoice(null);
    void (async () => {
      try {
        const [entryRes, notesRes] = await Promise.all([
          api.getEntry(entryId),
          api.listNotes(entryId),
        ]);
        if (!active) return;
        const currentEntry = entryRes ?? null;
        const notes = notesRes?.notes ?? [];
        const projectByNoteId: Record<string, string> = {};
        notes.forEach((note) => {
          if (note?.id) projectByNoteId[note.id] = currentEntry?.title ?? "";
        });
        setEntry(currentEntry);
        setSessions(
          parseProjectLogs(
            notes.map((note) => ({ id: note.id, body: note.content_markdown ?? "" })),
            projectByNoteId,
          ),
        );
        setError("");
      } catch (err) {
        if (active) {
          setSessions([]);
          setError(err instanceof Error ? err.message : "falha ao carregar a nota");
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [entryId, refreshKey]);

  // O feedback de copia dura 1,5 s; desmontar no meio nao deixa timer pendurado.
  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const title = entry?.title ?? "";
  const icon = iconChoice ?? entry?.icon ?? "";

  const chooseIcon = (value: string) => {
    setIconChoice(value);
    setPicker(null);
    // O icone persiste na entry; se a gravacao falhar, a tela nao quebra e a
    // escolha fica nesta sessao.
    void api.updateEntry(entryId, { icon: value }).catch(() => undefined);
  };

  const copyLink = (session: LogSession, url: string) => {
    if (!url) return;
    void (async () => {
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        return;
      }
      setCopiedId(session.sessionId);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopiedId(null), 1500);
    })();
  };

  // Lista fechada de comandos (docs/projetos.md): cada comando tem uma funcao
  // aqui; nada do documento vira codigo executado.
  const commandHandlers: Record<
    NoteAction["command"],
    (session: LogSession, action: NoteAction) => void
  > = {
    "filter-items": (session, action) => {
      onFilterItems(
        action.params.project || session.project,
        rangeForDate(action.params.date || session.date),
      );
    },
    "copy-link": (session, action) => {
      copyLink(session, action.params.url || "");
    },
  };

  const actionsFor = (session: LogSession): NoteAction[] => {
    const url = newestCommitUrl(session);
    const actions: NoteAction[] = [
      {
        id: "filter-items",
        label: "Filtrar itens",
        icon: "filter",
        command: "filter-items",
        params: { project: session.project, date: session.date },
      },
    ];
    if (url) {
      actions.push({
        id: "copy-link",
        label: "Copiar link",
        icon: "link",
        command: "copy-link",
        params: { url },
      });
    } else {
      actions.push({
        id: "copy-link",
        label: "Copiar link",
        icon: "link",
        command: "copy-link",
        params: {},
      });
    }
    return actions;
  };

  const actionIcon: Record<NoteActionIcon, ReactNode> = {
    filter: <FilterIcon size={13} />,
    link: <LinkIcon size={13} />,
  };

  const actionEnabled = (session: LogSession, action: NoteAction): boolean => {
    if (action.command === "copy-link") return Boolean(action.params.url);
    return session.items.length > 0;
  };

  const actionTitle = (session: LogSession, action: NoteAction): string | undefined => {
    if (actionEnabled(session, action)) return undefined;
    if (action.command === "copy-link") return "Sem link para copiar";
    return "Sem itens nesta sessão";
  };

  if (loading && sessions.length === 0 && !entry) {
    return (
      <section className="pjn">
        <p className="muted">
          <Spinner /> Carregando...
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="pjn">
        <p className="error">{error}</p>
      </section>
    );
  }

  const newest = sessions[0] ?? null;

  return (
    <section className="pjn">
      <header>
        <div className="pjn-title">
          <button
            type="button"
            className="pjn-emojibtn"
            aria-label={`trocar ícone de ${title}`}
            onClick={(event) =>
              setPicker({ current: icon, anchor: event.currentTarget.getBoundingClientRect() })
            }
          >
            <span className="pjn-mark" aria-hidden="true">
              {icon || (title.charAt(0) || "?")}
            </span>
          </button>
          <h1>{title}</h1>
        </div>
        <div className="pjn-meta">
          <span>{notebookName}</span>
          {newest ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{shortDate(newest.date)}</span>
              <span aria-hidden="true">·</span>
              <span className="pjn-host">{newest.host}</span>
            </>
          ) : null}
        </div>
      </header>

      {newest?.summary ? <p className="pjn-lede">{newest.summary}</p> : null}

      {sessions.length === 0 ? <p className="pjn-empty">Sem sessões registradas.</p> : null}

      {sessions.map((session) => {
        const counts = itemKindCounts(session.items);
        const kinds = kindsOf(session.items);
        const total = session.items.length;
        const actions = actionsFor(session);
        return (
          <section className="pjn-blk" key={session.sessionId}>
            <div className="pjn-cap">
              <BookIcon size={13} />
              <b>{shortDate(session.date)}</b>
              <span>· {session.host}</span>
              <span>
                · <span className="pjn-n">{total}</span> {total === 1 ? "item" : "itens"}
              </span>
            </div>
            <div className="pjn-grid">
              <div className="pjn-main">
                {total > 0 ? (
                  <ul className="pjn-items">
                    {session.items.map((item, at) => (
                      <li className="pjn-it" key={`${item.title}:${at}`}>
                        <span className="pjn-kw">
                          <span className={`pj-kb ${KIND_CLASS[item.kind] ?? ""}`}>
                            {item.kind}
                          </span>
                        </span>
                        <span className="pjn-tt" title={item.title}>
                          {item.title}
                        </span>
                        <span className="pjn-cc">
                          {item.commit ? <span className="pj-ch">{item.commit}</span> : null}
                          {item.url ? (
                            <a
                              className="pj-opc"
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              title="Abrir commit"
                            >
                              <ExternalIcon size={13} />
                            </a>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {total > 0 ? (
                  <table className="pjn-tbl">
                    <caption className="pjn-sr">
                      {`Itens por kind da sessão de ${shortDate(session.date)} em ${session.host}`}
                    </caption>
                    <thead>
                      <tr>
                        <th>Kind</th>
                        <th className="pjn-num">Itens</th>
                        <th className="pjn-num">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kinds.map((kind) => (
                        <tr key={kind}>
                          <td>{kind}</td>
                          <td className="pjn-num">{counts[kind]}</td>
                          <td className="pjn-num">
                            {((counts[kind] / total) * 100).toFixed(0)}%
                          </td>
                        </tr>
                      ))}
                      <tr className="pjn-tot">
                        <td>Total</td>
                        <td className="pjn-num">{total}</td>
                        <td className="pjn-num">100%</td>
                      </tr>
                    </tbody>
                  </table>
                ) : null}
              </div>
              <div className="pjn-act">
                {actions.map((action) => {
                  const enabled = actionEnabled(session, action);
                  return (
                    <button
                      type="button"
                      key={action.id}
                      className="pjn-ab"
                      disabled={!enabled}
                      aria-disabled={enabled ? undefined : "true"}
                      title={actionTitle(session, action)}
                      onClick={() => {
                        if (!isNoteCommand(action.command)) return;
                        commandHandlers[action.command](session, action);
                      }}
                    >
                      {actionIcon[action.icon]}
                      <span>{action.label}</span>
                    </button>
                  );
                })}
                {copiedId === session.sessionId ? (
                  <span className="pjn-stx" aria-live="polite">
                    <CheckIcon size={13} />
                    <span>Copiado</span>
                  </span>
                ) : null}
              </div>
            </div>
          </section>
        );
      })}

      <footer className="pjn-foot">
        <button type="button" className="pjn-edit" onClick={onEdit}>
          <PencilIcon size={13} />
          Editar
        </button>
      </footer>

      {picker ? (
        <EmojiPicker
          anchor={picker.anchor}
          current={picker.current}
          onPick={chooseIcon}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </section>
  );
}
