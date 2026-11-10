import { useEffect, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { api } from "../api";
import { EmojiPicker } from "../components/EmojiPicker";
import { Spinner } from "../components/Status";
import { ChevronIcon, ExternalIcon } from "../components/icons";
import {
  parseProjectLogs,
  type LogItem,
  type LogSession,
} from "../../../mobile/src/core/projetoLog";
import type { ProjectsRange } from "../lib/actions";
import type { Entry, Note } from "../types";

/**
 * Superficie "Projetos" do caderno MCP (docs/projetos.md). Um notebook de
 * kind=mcp substitui a lista de notas: o corpo das entradas e lido pelo
 * modulo projetoLog e vira duas vistas, Itens (tabela/cartoes) e Projetos.
 * O prototipo aprovado (proto-resumos.html) e a fonte da verdade visual.
 */

/** Pedido de filtro vindo de fora (nota do projeto): abre Itens filtrada. */
export interface ProjectsFilterRequest extends Record<string, unknown> {
  project: string;
  range: ProjectsRange;
  /** Muda a cada pedido; o mesmo filtro repetido precisa re-aplicar. */
  nonce: number;
}

interface ProjectsViewProps {
  notebookId: string;
  refreshKey: number;
  /** Abre a nota do projeto no editor que ja existe; nao cria rota nova. */
  onOpenEntry: (entryId: string) => void;
  /** Filtro aplicado de fora (acao "Filtrar itens" da nota do projeto). */
  filterRequest?: ProjectsFilterRequest | null;
}

type TabId = "items" | "projects";
type RangeId = ProjectsRange;
type VariantId = "table" | "cards";

/** Linha da tabela/cartao: um item de sessao amarrado a entry do caderno. */
interface ItemRow extends LogItem {
  entryId: string | null;
}

interface SessionRow {
  session: LogSession;
  entryId: string | null;
}

/** Uma linha da aba Projetos, amarrada a entry: titulo e identidade, icone. */
interface ProjectAgg {
  project: string;
  entryId: string;
  sessions: SessionRow[];
}

interface ProjectsIndex {
  rows: ItemRow[];
  sessions: SessionRow[];
  entries: Entry[];
  entryByProject: Record<string, string>;
  kinds: string[];
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
  const ms = day * 864e5;
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "hoje", "ontem" ou "ha N dias"; sem trabalho quando nunca houve. */
function relativeLabel(date: string | null): string {
  if (!date) return "sem trabalho";
  const diff = todayNumber() - dayNumber(date);
  if (diff <= 0) return "hoje";
  if (diff === 1) return "ontem";
  return `há ${diff} dias`;
}

function newerFirst(a: { date: string; time: string }, b: { date: string; time: string }): number {
  const key = (one: { date: string; time: string }) => `${one.date}T${one.time}`;
  if (key(a) !== key(b)) return key(a) > key(b) ? -1 : 1;
  return 0;
}

/** Constroi o indice uma vez por (notebook, notas): parsing so no modulo puro. */
function buildIndex(entries: Entry[], noteLists: Note[][]): ProjectsIndex {
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
      rows.push({ ...item, entryId: row.entryId });
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
function aggregate(index: ProjectsIndex): ProjectAgg[] {
  return index.entries
    .filter((entry) => Boolean(entry.title))
    .map((entry) => ({
      project: entry.title,
      entryId: entry.id,
      sessions: index.sessions.filter((row) => row.session.project === entry.title),
    }));
}

function KindBadge({ kind }: { kind: string }) {
  return <span className={`pj-kb ${KIND_CLASS[kind] ?? ""}`}>{kind}</span>;
}

/** Quadrado da letra quando o projeto ainda nem tem icone. */
function ProjectMark({ icon, project }: { icon: string; project: string }) {
  return (
    <span className="pj-mark" aria-hidden="true">
      {icon || (project.charAt(0) || "?")}
    </span>
  );
}

interface PickerSpot {
  entryId: string;
  current: string;
  anchor: DOMRect;
}

export function ProjectsView({
  notebookId,
  refreshKey,
  onOpenEntry,
  filterRequest,
}: ProjectsViewProps) {
  const [index, setIndex] = useState<ProjectsIndex | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabId>("items");
  const [projectFilter, setProjectFilter] = useState<Set<string>>(new Set());
  const [kindFilter, setKindFilter] = useState<Set<string>>(new Set());
  const [range, setRange] = useState<RangeId>("all");
  const [variant, setVariant] = useState<VariantId>("table");
  const [openProjects, setOpenProjects] = useState<Record<string, boolean>>({});
  const [icons, setIcons] = useState<Record<string, string>>({});
  /** Janela estreita (<720px): so cartoes, e o segmento fica desabilitado. */
  const [narrow, setNarrow] = useState(() =>
    typeof window === "undefined" ? false : window.innerWidth <= 720,
  );
  const [picker, setPicker] = useState<PickerSpot | null>(null);

  // Carrega uma vez por notebook (e a cada refresh): a lista de notas nao roda
  // mais no caderno MCP, entao a leitura e sempre fresca (as variantes Cached
  // chegaram vazias no primeiro acesso). Notas de todas as entries em paralelo
  // (sao poucas). Cancelamento local: trocar de caderno no meio da leitura nao
  // pode marcar estado tardiamente.
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

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(max-width: 720px)");
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Filtro pedido de fora (nota do projeto): abre a aba Itens ja filtrada
  // pelo projeto e pelo periodo da sessao.
  useEffect(() => {
    if (!filterRequest) return;
    setTab("items");
    setProjectFilter(new Set([filterRequest.project]));
    setRange(filterRequest.range);
  }, [filterRequest]);

  if (loading && !index) {
    return (
      <section className="pj-view">
        <p className="muted">
          <Spinner /> Carregando...
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="pj-view">
        <p className="error">{error}</p>
      </section>
    );
  }

  const data = index ?? { rows: [], sessions: [], entries: [], entryByProject: {}, kinds: [] };
  const projects = aggregate(data);

  // Filtro vigente: chips somados + periodo. Derivado por render, o indice
  // pesado e construido uma vez so (no buildIndex).
  const limit = range === "all" ? 0 : range === "7" ? 6 : 29;
  const keep = (row: LogItem) => {
    if (projectFilter.size > 0 && !(row.project && projectFilter.has(row.project))) return false;
    if (kindFilter.size > 0 && !kindFilter.has(row.kind)) return false;
    if (limit > 0) {
      const day = dayNumber(row.date);
      if (Number.isNaN(day) || day < todayNumber() - limit) return false;
    }
    return true;
  };
  const filtered = data.rows.filter(keep);
  const filteredSessions = data.sessions
    .map((row) => ({ ...row, items: row.session.items.filter(keep) }))
    .filter((row) => row.items.length > 0);
  const filteredProjects = new Set(filtered.map((row) => row.project)).size;

  /** Icone de um projeto no estado atual (escolha local vence a entry). */
  const iconFor = (project: string): string => {
    const entry = projects.find((agg) => agg.project === project);
    if (entry) {
      const chosen = icons[entry.entryId];
      if (chosen) return chosen;
      const entryRecord = data.entries.find((record) => record.id === entry.entryId);
      if (entryRecord?.icon) return entryRecord.icon;
    }
    return "";
  };

  const openRow = (row: LogItem & { entryId?: string | null }) => {
    if (row.entryId) onOpenEntry(row.entryId);
  };

  const toggleSet = (value: string, setter: (next: Set<string>) => void, current: Set<string>) => {
    const next = new Set(current);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    setter(next);
  };

  /** Abre o seletor colado no botao de icone, como no prototipo. */
  const openPicker = (event: ReactMouseEvent<HTMLElement>, project: string, entryId: string) => {
    event.stopPropagation();
    setPicker({
      entryId,
      current: iconFor(project),
      anchor: event.currentTarget.getBoundingClientRect(),
    });
  };

  const chooseIcon = (entryId: string, value: string) => {
    setIcons((current) => ({ ...current, [entryId]: value }));
    setPicker(null);
    // O icone persiste na entry; se a gravacao falhar, a tela nao quebra e a
    // escolha fica nesta sessao.
    void api.updateEntry(entryId, { icon: value }).catch(() => undefined);
  };

  const commitCell = (row: { commit?: string; url?: string }): ReactNode => {
    if (!row.commit) return "";
    return (
      <>
        <span className="pj-ch">{row.commit}</span>
        {row.url ? (
          <a className="pj-opc" href={row.url} target="_blank" rel="noreferrer" title="Abrir commit">
            <ExternalIcon size={13} />
          </a>
        ) : null}
      </>
    );
  };

  const activeChip = (on: boolean) => `pj-chip${on ? " pj-chip--on" : ""}`;

  const tableVisible = !narrow && variant === "table";
  const cardsVisible = narrow || variant === "cards";

  const emptyState = (
    <p className="pj-empty">Sem sessões registradas.</p>
  );

  return (
    <div className="pj-root">
      <section className="pj-view">
        <header className="pj-head">
          <nav className="pj-tabs" role="tablist" aria-label="Vistas de projetos">
            <button
              type="button"
              role="tab"
              id="pj-tab-itens"
              aria-selected={tab === "items"}
              onClick={() => setTab("items")}
            >
              Itens
              <span className="pj-tabn">{filtered.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              id="pj-tab-projetos"
              aria-selected={tab === "projects"}
              onClick={() => setTab("projects")}
            >
              Projetos
            </button>
          </nav>
        </header>

        {tab === "items" ? (
          <div role="tabpanel" aria-labelledby="pj-tab-itens">
            {projects.length > 0 || data.rows.length > 0 ? (
              <div className="pj-toolbar">
                <span className="pj-chips">
                  {projects.map((agg) => (
                    <button
                      key={agg.entryId}
                      type="button"
                      className={activeChip(projectFilter.has(agg.project))}
                      aria-pressed={projectFilter.has(agg.project)}
                      onClick={() => toggleSet(agg.project, setProjectFilter, projectFilter)}
                    >
                      <ProjectMark icon={iconFor(agg.project)} project={agg.project} />
                      {agg.project}
                    </button>
                  ))}
                </span>
                <span className="pj-sep" aria-hidden="true" />
                <span className="pj-chips">
                  {data.kinds.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      className={`${activeChip(kindFilter.has(kind))} pj-kchip`}
                      aria-pressed={kindFilter.has(kind)}
                      onClick={() => toggleSet(kind, setKindFilter, kindFilter)}
                    >
                      {kind}
                    </button>
                  ))}
                </span>
                <span className="pj-sep" aria-hidden="true" />
                <div className="pj-seg" role="group" aria-label="Período">
                  {(
                    [
                      ["7", "7 dias"],
                      ["30", "30 dias"],
                      ["all", "tudo"],
                    ] as Array<[RangeId, string]>
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={range === value}
                      onClick={() => setRange(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className="pj-push" />
                <div
                  className={`pj-seg${narrow ? " pj-seg--off" : ""}`}
                  role="group"
                  aria-label="Variante"
                  aria-disabled={narrow}
                >
                  <button
                    type="button"
                    aria-pressed={!narrow && variant === "table"}
                    onClick={() => setVariant("table")}
                  >
                    Tabela
                  </button>
                  <button
                    type="button"
                    aria-pressed={narrow || variant === "cards"}
                    onClick={() => setVariant("cards")}
                  >
                    Cartões
                  </button>
                </div>
              </div>
            ) : null}

            {filtered.length === 0 ? (
              emptyState
            ) : (
              <>
                <div className="pj-vtable" hidden={!tableVisible}>
                  <table>
                    <colgroup>
                      <col className="pj-col-pj" />
                      <col />
                      <col className="pj-col-k" />
                      <col className="pj-col-d" />
                      <col className="pj-col-c" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Projeto</th>
                        <th>Item</th>
                        <th>Kind</th>
                        <th>Data</th>
                        <th>Commit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((row, at) => (
                        <tr
                          key={`${row.sessionId}:${at}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => openRow(row)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              openRow(row);
                            }
                          }}
                        >
                          <td>
                            <span className="pj-pcell">
                              <ProjectMark icon={iconFor(row.project)} project={row.project} />
                              {row.project}
                            </span>
                          </td>
                          <td title={row.title}>{row.title}</td>
                          <td>
                            <KindBadge kind={row.kind} />
                          </td>
                          <td>{shortDate(row.date)}</td>
                          <td>{commitCell(row)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="pj-vcards" hidden={!cardsVisible}>
                  {filteredSessions.map((row) => (
                    <section className="pj-sess" key={row.session.sessionId}>
                      <div className="pj-ssh">
                        <ProjectMark icon={iconFor(row.session.project)} project={row.session.project} />
                        <b>{row.session.project}</b>
                        <span className="pj-m">
                          · {shortDate(row.session.date)} · {row.session.host}
                        </span>
                        <span className="pj-cnt">
                          {row.items.length} {row.items.length === 1 ? "item" : "itens"}
                        </span>
                      </div>
                      {row.items.map((item, at) => (
                        <div
                          className="pj-ci"
                          role="button"
                          tabIndex={0}
                          key={`${item.title}:${at}`}
                          onClick={() => openRow(item)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              openRow(item);
                            }
                          }}
                        >
                          <span className="pj-kw">
                            <KindBadge kind={item.kind} />
                          </span>
                          <span className="pj-tt" title={item.title}>
                            {item.title}
                          </span>
                          <span className="pj-cc">{commitCell(item)}</span>
                        </div>
                      ))}
                    </section>
                  ))}
                </div>
              </>
            )}

            <footer className="pj-foot">
              <p className="pj-foot-row">
                <span>
                  {filtered.length} {filtered.length === 1 ? "item" : "itens"} · {filteredProjects}{" "}
                  {filteredProjects === 1 ? "projeto" : "projetos"}
                </span>
              </p>
            </footer>
          </div>
        ) : null}

        {tab === "projects" ? (
          <div className="pj-projects" role="tabpanel" aria-labelledby="pj-tab-projetos">
            {projects.length === 0 ? emptyState : null}
            {projects.map((agg) => {
              // A janela de 35 dias do prototipo: o resumo do projeto olha o
              // trabalho recente; sessoes mais antigas ficam fora da linha e da
              // expansao.
              const recentSessions = agg.sessions.filter((row) =>
                row.session.items.some((item) => {
                  const day = dayNumber(item.date);
                  return !Number.isNaN(day) && day >= todayNumber() - 34;
                }),
              );
              const recent = recentSessions.flatMap((row) => row.session.items);
              const last = recentSessions[0]?.session.date ?? null;
              const state =
                last === null
                  ? ""
                  : todayNumber() - dayNumber(last) <= 1
                    ? " pj-dot--ok"
                    : todayNumber() - dayNumber(last) <= 8
                      ? " pj-dot--warn"
                      : "";
              const open = Boolean(openProjects[agg.entryId]);
              return (
                <div className="pj" key={agg.entryId}>
                  <div
                    className="pj-row"
                    role="button"
                    tabIndex={0}
                    aria-expanded={open}
                    onClick={() => setOpenProjects((current) => ({ ...current, [agg.entryId]: !open }))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setOpenProjects((current) => ({ ...current, [agg.entryId]: !open }));
                      }
                    }}
                  >
                    <button
                      type="button"
                      className="pj-emojibtn"
                      aria-label={`trocar ícone de ${agg.project}`}
                      onClick={(event) => openPicker(event, agg.project, agg.entryId)}
                    >
                      <ProjectMark icon={iconFor(agg.project)} project={agg.project} />
                    </button>
                    <div className="pj-name">
                      <div className="pj-pnm">{agg.project}</div>
                      <div className="pj-psub">
                        {relativeLabel(last)} · {recent.length} {recent.length === 1 ? "item" : "itens"}
                      </div>
                    </div>
                    <span className="pj-plast">{relativeLabel(last)}</span>
                    <span className="pj-pnum">
                      <span className="pj-n">{recent.length}</span> {recent.length === 1 ? "item" : "itens"}
                    </span>
                    <span className="pj-mbar" aria-hidden="true">
                      {KIND_ORDER.map((kind) => {
                        const count = recent.filter((row) => row.kind === kind).length;
                        if (count === 0) return null;
                        return (
                          <i
                            key={kind}
                            className={KIND_CLASS[kind] ?? ""}
                            style={{ width: `${((count / recent.length) * 100).toFixed(1)}%` }}
                          />
                        );
                      })}
                    </span>
                    <span>
                      <span className={`pj-dot${state}`} title={relativeLabel(last)} />
                    </span>
                    <span className="pj-chev">
                      <ChevronIcon size={15} />
                    </span>
                  </div>
                  {open
                    ? recentSessions.map((row) => (
                        <div className="pj-sz" key={row.session.sessionId}>
                          <div className="pj-sline">
                            <b>{shortDate(row.session.date)}</b>
                            <span>· {row.session.host}</span>
                            <span>
                              · {row.session.items.length}{" "}
                              {row.session.items.length === 1 ? "item" : "itens"}
                            </span>
                            <span className="pj-push" />
                            {row.entryId ? (
                              <button
                                type="button"
                                className="pj-notabtn"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onOpenEntry(row.entryId as string);
                                }}
                              >
                                Nota
                              </button>
                            ) : null}
                          </div>
                          {row.session.items.map((item, at) => (
                            <div
                              className="pj-it2"
                              role="button"
                              tabIndex={0}
                              key={`${item.title}:${at}`}
                              onClick={() => openRow(item)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  openRow(item);
                                }
                              }}
                            >
                              <span className="pj-kw">
                                <KindBadge kind={item.kind} />
                              </span>
                              <span className="pj-tt" title={item.title}>
                                {item.title}
                              </span>
                              <span className="pj-cc">{commitCell(item)}</span>
                            </div>
                          ))}
                          {row.session.commits.length > 0 || row.session.links.length > 0 ? (
                            <details className="pj-det">
                              <summary>
                                <span className="pj-chev pj-chev--sm">
                                  <ChevronIcon size={13} />
                                </span>
                                Detalhes técnicos
                              </summary>
                              <div className="pj-db">
                                {row.session.commits.map((commit, at) => (
                                  <span key={`${commit.hash}:${at}`}>
                                    {commit.hash ? `${commit.hash} — ` : ""}
                                    {commit.message}
                                    {commit.url ? (
                                      <a
                                        className="pj-opc"
                                        href={commit.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        title="Abrir commit"
                                      >
                                        <ExternalIcon size={13} />
                                      </a>
                                    ) : null}
                                  </span>
                                ))}
                                {row.session.links.map((link, at) => (
                                  <span key={`${link.url}:${at}`}>
                                    {link.label ? `${link.label}: ` : ""}
                                    <a href={link.url} target="_blank" rel="noreferrer">
                                      {link.url}
                                    </a>
                                  </span>
                                ))}
                              </div>
                            </details>
                          ) : null}
                        </div>
                      ))
                    : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </section>

      {picker ? (
        <EmojiPicker
          anchor={picker.anchor}
          current={picker.current}
          onPick={(emoji) => chooseIcon(picker.entryId, emoji)}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </div>
  );
}
