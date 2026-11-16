import { useEffect, useRef, useState } from "react";
import type {
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { Spinner } from "../components/Status";
import {
  findFolder,
  findSessionNode,
  scopeRows,
  type ProjectsIndex,
  type ProjectsNode,
} from "../lib/useProjectsIndex";
import type { LogItem } from "../../../mobile/src/core/projetoLog";
import { FolderPane, SessionPane } from "./ProjectNote";
import "./projects.css";

/**
 * Superficie "Projetos" do caderno MCP (docs/projetos.md). A navegacao vive na
 * arvore da sidebar (ProjectList); aqui esta a leitura do no escolhido: o
 * painel da nota da sessao, o agregado da pasta, e a tabela Itens sobre o
 * mesmo indice, escopada ao no. O prototipo aprovado (sessoes-v2.html) e a
 * referencia de estrutura; todo valor visual vem do sistema de interface.
 */

export interface ProjectsViewProps {
  index: ProjectsIndex | null;
  loading: boolean;
  error: string;
  /** No escolhido na arvore; nullavel nao existe: "all" e o padrao. */
  node: ProjectsNode;
  /** O painel linka de volta para uma sessao (lista da pasta). */
  onSelectNode: (node: ProjectsNode) => void;
  /** Abre o editor de markdown da nota; nao cria rota nova. */
  onOpenEntry: (entryId: string) => void;
}

type ViewId = "nota" | "itens";
type RangeId = "7" | "30" | "all";
type VariantId = "table" | "cards";
type TableWidth = "contained" | "full";
type TableDensity = "compact" | "comfortable" | "wide";
type TableAppearance = "lines" | "grade" | "zebra";
interface TableCols {
  proj: boolean;
  kind: boolean;
  data: boolean;
  commit: boolean;
  sess: boolean;
}
/** Colunas opcionais: podem ser escondidas no painel de colunas. */
const TABLE_COL_KEYS = ["proj", "kind", "data", "commit", "sess"] as const;
type OptionalColKey = (typeof TABLE_COL_KEYS)[number];
/** Ordem das colunas na tabela. A coluna Item nunca some. */
const COL_ORDER = ["proj", "item", "kind", "data", "commit", "sess"] as const;
type TableColKey = (typeof COL_ORDER)[number];
/** Arraste em andamento: origem, largura inicial, largura viva e o gelo. */
interface ResizeState {
  key: TableColKey;
  startX: number;
  startWidth: number;
  width: number;
  /** Larguras medidas no pointerdown de todas as colunas visiveis. */
  frozen: Partial<Record<TableColKey, number>>;
}
interface TablePrefs {
  width: TableWidth;
  density: TableDensity;
  cols: TableCols;
  appearance: TableAppearance;
  customOpen: boolean;
  /** Largura fixa por coluna, em px. Ausente = coluna no automatico. */
  colWidths: Partial<Record<TableColKey, number>>;
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const TABLE_PREFS_KEY = "dyarium.projetos.tabela";
const DEFAULT_TABLE_PREFS: TablePrefs = {
  width: "full",
  density: "comfortable",
  cols: { proj: true, kind: true, data: true, commit: true, sess: true },
  appearance: "grade",
  customOpen: false,
  colWidths: {},
};
/** Limites do arraste: abaixo disso a coluna fica inutil, acima disso vira oleo. */
const MIN_COL_WIDTH = 56;
const MAX_COL_WIDTH = 640;
/** A Item e a coluna do texto: ela nasce maior que as outras (absorve o que
 *  sobra), entao o teto dela e maior que o das demais. */
const ITEM_MAX_WIDTH = 1280;
/** Espelhando as classes .pjx-col-* do CSS: largura natural de cada coluna. */
const DEFAULT_COL_WIDTHS: Record<OptionalColKey, number> = {
  proj: 150,
  kind: 72,
  data: 72,
  commit: 110,
  sess: 96,
};
/** Classe de largura natural de cada coluna opcional. */
const COL_CLASS: Record<OptionalColKey, string> = {
  proj: "pjx-col-pj",
  kind: "pjx-col-k",
  data: "pjx-col-d",
  commit: "pjx-col-c",
  sess: "pjx-col-s",
};
/** Passo do teclado: seta move 8px, com Shift 32px. */
const KEY_STEP = 8;
const KEY_STEP_FAST = 32;
/** A coluna Item nunca some: ela ganha o que sobra, mas nunca menos que isto. */
const ITEM_MIN_WIDTH = 140;
/** Largura de reserva da Item quando o navegador nao devolve medida (teste). */
const ITEM_FALLBACK_WIDTH = 240;

/** Piso de cada coluna: a Item tem piso maior, porque e a coluna do texto. */
function minWidthFor(key: TableColKey): number {
  return key === "item" ? ITEM_MIN_WIDTH : MIN_COL_WIDTH;
}

/** Teto de cada coluna: a Item nasce maior, entao o teto dela tambem. */
function maxWidthFor(key: TableColKey): number {
  return key === "item" ? ITEM_MAX_WIDTH : MAX_COL_WIDTH;
}

function clampColWidth(value: number, key: TableColKey): number {
  const min = minWidthFor(key);
  const max = maxWidthFor(key);
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

const TABLE_COL_LABELS: Record<TableColKey, string> = {
  proj: "Projeto",
  item: "Item",
  kind: "Kind",
  data: "Data",
  commit: "Commit",
  sess: "Sessão",
};
/** Densidade so muda a geometria da linha (26 / 30 / 36); o tipo nao muda. */
const TABLE_DENSITY_VALUES: Record<TableDensity, number> = {
  compact: 26,
  comfortable: 30,
  wide: 36,
};

function normalizeTablePrefs(raw: unknown): TablePrefs {
  const base = { ...DEFAULT_TABLE_PREFS, cols: { ...DEFAULT_TABLE_PREFS.cols }, colWidths: {} };
  if (!raw || typeof raw !== "object") return base;
  const obj = raw as Record<string, unknown>;
  const width = obj.width === "contained" || obj.width === "full" ? obj.width : base.width;
  const density =
    obj.density === "compact" || obj.density === "comfortable" || obj.density === "wide"
      ? obj.density
      : base.density;
  const appearance =
    obj.appearance === "lines" || obj.appearance === "grade" || obj.appearance === "zebra"
      ? obj.appearance
      : base.appearance;
  const colsRaw = obj.cols && typeof obj.cols === "object" ? (obj.cols as Record<string, unknown>) : {};
  const cols: TableCols = { ...base.cols };
  for (const key of TABLE_COL_KEYS) {
    if (typeof colsRaw[key] === "boolean") cols[key] = colsRaw[key] as boolean;
  }
  // Garante ao menos 3 opcionais marcadas.
  if (Object.values(cols).filter(Boolean).length < 3) {
    for (const key of TABLE_COL_KEYS) cols[key] = DEFAULT_TABLE_PREFS.cols[key];
  }
  const customOpen = typeof obj.customOpen === "boolean" ? obj.customOpen : base.customOpen;
  // Larguras: numero valido vira largura; o resto (string, negativo, NaN) e
  // ignorado e a coluna fica no automatico.
  const widthsRaw =
    obj.colWidths && typeof obj.colWidths === "object"
      ? (obj.colWidths as Record<string, unknown>)
      : {};
  const colWidths: Partial<Record<TableColKey, number>> = {};
  for (const key of COL_ORDER) {
    const value = widthsRaw[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      colWidths[key] = clampColWidth(value, key);
    }
  }
  return { width, density, cols, appearance, customOpen, colWidths };
}

function loadTablePrefs(): TablePrefs {
  const base = { ...DEFAULT_TABLE_PREFS, cols: { ...DEFAULT_TABLE_PREFS.cols }, colWidths: {} };
  if (typeof window === "undefined") return base;
  try {
    const raw = window.localStorage.getItem(TABLE_PREFS_KEY);
    if (!raw) return base;
    return normalizeTablePrefs(JSON.parse(raw));
  } catch {
    return base;
  }
}

/** Compara sem acento e sem caixa: a busca nao deve exigir o acerto exato. */
function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

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

/** Rotulo de kind na tabela: mono neutro, nunca cor de kind. */
function KindBadge({ kind }: { kind: string }) {
  return <span className="pjx-kb dy-mono">{kind}</span>;
}

function SearchGlyph() {
  return (
    <span className="pjx-ico pjx-ico--sm" aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round">
        <circle cx="7" cy="7" r="4.5" />
        <path d="m14 14-3.2-3.2" />
      </svg>
    </span>
  );
}

function FilterGlyph() {
  return (
    <span className="pjx-ico pjx-ico--sm" aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round">
        <path d="M2.5 4h11M4.5 8h7M6.5 12h3" />
      </svg>
    </span>
  );
}

function SlidersGlyph() {
  return (
    <span className="pjx-ico pjx-ico--sm" aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round">
        <path d="M3 5h10M3 11h10" />
        <circle cx="6" cy="5" r="1.8" />
        <circle cx="10" cy="11" r="1.8" />
      </svg>
    </span>
  );
}

function RefreshGlyph() {
  return (
    <span className="pjx-ico pjx-ico--sm" aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 8a5 5 0 1 1-1.5-3.5M13 1.5V5h-3.5" />
      </svg>
    </span>
  );
}

export function ProjectsView({
  index,
  loading,
  error,
  node,
  onSelectNode,
  onOpenEntry,
}: ProjectsViewProps) {
  const [view, setView] = useState<ViewId>("nota");
  const [kindFilter, setKindFilter] = useState<Set<string>>(new Set());
  const [range, setRange] = useState<RangeId>("all");
  const [variant, setVariant] = useState<VariantId>("table");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [tablePrefs, setTablePrefs] = useState<TablePrefs>(loadTablePrefs);
  const [colsPanelOpen, setColsPanelOpen] = useState(false);
  /** Janela estreita (<720px): so cartoes, e o segmento fica desabilitado. */
  const [narrow, setNarrow] = useState(() =>
    typeof window === "undefined" ? false : window.innerWidth <= 720,
  );
  /** Arraste de coluna em andamento: guarda a origem e a largura ao vivo. */
  const [resize, setResizeState] = useState<ResizeState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);
  /** Larguras medidas na mesa (px). Nao vao para o localStorage: valem so
   *  para a sessao, para as vizinhas nao pularem quando uma coluna muda. */
  const [measured, setMeasured] = useState<Partial<Record<TableColKey, number>>>({});

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(max-width: 720px)");
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(TABLE_PREFS_KEY, JSON.stringify(tablePrefs));
    } catch {
      // ignore
    }
  }, [tablePrefs]);

  const data: ProjectsIndex = index ?? {
    rows: [],
    sessions: [],
    entries: [],
    entryByProject: {},
    kinds: [],
    tree: { machines: [], sessions: [], count: 0 },
    v1Projects: [],
  };

  // O no escolhido pode ou nao ter painel de leitura (sessao/pasta). Ao
  // trocar de no, a vista vai para o painel quando ele existe; senao, para a
  // tabela.
  const sessionNode = node.kind === "session" ? findSessionNode(data.tree, node.id) : null;
  const folderNode = node.kind === "folder" ? findFolder(data.tree, node.machine, node.path) : null;
  const paneKind: "session" | "folder" | null = sessionNode
    ? "session"
    : folderNode
      ? "folder"
      : null;

  useEffect(() => {
    setView(node.kind === "session" || node.kind === "folder" ? "nota" : "itens");
  }, [node]);

  const effectiveView: ViewId = paneKind ? view : "itens";

  // Filtro vigente: escopo do no + chips de kind + periodo + busca.
  // Derivado por render, o indice pesado e construido uma vez so (no hook).
  const scoped = scopeRows(data, node);
  const limit = range === "all" ? 0 : range === "7" ? 6 : 29;
  const keep = (row: LogItem) => {
    if (search.trim()) {
      const needle = foldText(search);
      const haystack = foldText(`${row.title} ${row.project} ${row.kind} ${row.commit ?? ""}`);
      if (!haystack.includes(needle)) return false;
    }
    if (kindFilter.size > 0 && !kindFilter.has(row.kind)) return false;
    if (limit > 0) {
      const day = dayNumber(row.date);
      if (Number.isNaN(day) || day < todayNumber() - limit) return false;
    }
    return true;
  };
  const filtered = scoped.filter(keep);
  const scopedSessionIds = new Set(scoped.map((row) => row.sessionId));
  const filteredSessions = data.sessions
    .filter((row) => scopedSessionIds.has(row.session.sessionId))
    .map((row) => ({ ...row, items: row.session.items.filter(keep) }))
    .filter((row) => row.items.length > 0);
  const filteredProjects = new Set(filtered.map((row) => row.project)).size;

  const openRow = (row: LogItem & { entryId?: string | null }): void => {
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

  const commitCell = (row: { commit?: string; url?: string }): ReactNode => {
    if (!row.commit) return "";
    if (row.url) {
      return (
        <a className="pjx-cc dy-mono" href={row.url} target="_blank" rel="noreferrer" title="abrir commit">
          {row.commit}
        </a>
      );
    }
    return <span className="pjx-cc pjx-cc--plain dy-mono">{row.commit}</span>;
  };

  const activeChip = (on: boolean) => `pjx-chip${on ? " pjx-chip--on" : ""}`;

  const tableVisible = !narrow && variant === "table";
  const cardsVisible = narrow || variant === "cards";

  // Projeto escolhido (no de projeto v1): a coluna "Projeto" so repetiria o
  // nome que ja esta fixado na arvore; ela sai da tabela neste escopo.
  const visibleOptionalCols = TABLE_COL_KEYS.filter(
    (key) => tablePrefs.cols[key] && !(key === "proj" && node.kind === "project"),
  );
  const canUncheckCol = (key: string) =>
    !(tablePrefs.cols[key as keyof TableCols] && visibleOptionalCols.length <= 3);

  const updatePrefs = (patch: Partial<TablePrefs>) =>
    setTablePrefs((current) => ({ ...current, ...patch }));
  const setWidth = (width: TableWidth) => updatePrefs({ width });
  const setDensity = (density: TableDensity) => updatePrefs({ density });
  const setAppearance = (appearance: TableAppearance) => updatePrefs({ appearance });
  const toggleCustom = () => {
    setTablePrefs((current) => {
      const next = { ...current, customOpen: !current.customOpen };
      if (next.customOpen) setColsPanelOpen(true);
      return next;
    });
  };
  const resetPrefs = () => {
    setMeasured({});
    setTablePrefs({
      ...DEFAULT_TABLE_PREFS,
      cols: { ...DEFAULT_TABLE_PREFS.cols },
      colWidths: {},
    });
  };

  // --- Redimensionamento de coluna ---------------------------------------
  // A coluna arrastada fica em companhia de um "gelo": no pointerdown todas as
  // colunas visiveis sao medidas e congeladas, e a tabela cresce na mesma
  // medida. Sem isso a coluna vizinha encolhe junto com o arraste e a borda
  // que o mouse arrasta sai do lugar.

  /** Colunas visiveis, na ordem em que aparecem na tabela. */
  const visibleColKeys: TableColKey[] = COL_ORDER.filter(
    (key) => key === "item" || visibleOptionalCols.includes(key as OptionalColKey),
  );

  /** Largura que a coluna teria se nada fosse medido nem salvo. */
  const fallbackWidth = (key: TableColKey): number =>
    tablePrefs.colWidths[key] ??
    (key === "item" ? ITEM_FALLBACK_WIDTH : DEFAULT_COL_WIDTHS[key]);

  /** Largura explicita da coluna (px), quando existe. Sem isso, a coluna
   *  fica no automatico: a Item absorve o que sobrar, as outras usam o CSS. */
  const explicitWidth = (key: TableColKey): number | undefined => {
    if (resize) {
      if (resize.key === key) return resize.width;
      const frozen = resize.frozen[key];
      if (frozen !== undefined) return frozen;
    }
    const measuredWidth = measured[key];
    if (measuredWidth !== undefined) return measuredWidth;
    return tablePrefs.colWidths[key];
  };

  /** Largura em vigor da coluna, para o aria e para os calculos. */
  const effectiveWidth = (key: TableColKey): number => {
    const explicit = explicitWidth(key);
    if (explicit !== undefined) return explicit;
    if (key === "item") return 0;
    return DEFAULT_COL_WIDTHS[key];
  };

  /** Largura total da tabela: a soma das colunas visiveis. Enquanto a Item
   *  esta no automatico (sem medida), a tabela fica em 100% e quem absorve o
   *  que sobra e a propria Item. */
  const tableWidth = ((): number | undefined => {
    let sum = 0;
    for (const key of visibleColKeys) {
      const explicit = explicitWidth(key);
      if (explicit !== undefined) {
        sum += explicit;
        continue;
      }
      if (key === "item") return undefined;
      sum += DEFAULT_COL_WIDTHS[key];
    }
    return sum;
  })();

  const setResize = (next: ResizeState | null) => {
    resizeRef.current = next;
    setResizeState(next);
  };

  const beginResize = (key: TableColKey, event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    // Mede todas as colunas visiveis: elas ficam congeladas durante o arraste.
    const table = event.currentTarget.closest("table");
    const headers = table ? Array.from(table.querySelectorAll<HTMLElement>("thead th")) : [];
    const frozen: Partial<Record<TableColKey, number>> = {};
    for (const th of headers) {
      const col = th.dataset.col as TableColKey | undefined;
      if (!col) continue;
      const width = th.getBoundingClientRect().width;
      frozen[col] = width > 0 ? Math.round(width) : fallbackWidth(col);
    }
    const startWidth = frozen[key] ?? fallbackWidth(key);
    setMeasured((current) => ({ ...current, ...frozen }));
    setResize({ key, startX: event.clientX, startWidth, width: startWidth, frozen });
    const target = event.currentTarget;
    if (typeof target.setPointerCapture === "function") {
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        // navegador sem captura de ponteiro: o arraste segue pelos eventos.
      }
    }
  };

  const moveResize = (key: TableColKey, event: ReactPointerEvent<HTMLSpanElement>) => {
    const state = resizeRef.current;
    if (!state || state.key !== key) return;
    event.preventDefault();
    setResize({
      ...state,
      width: clampColWidth(state.startWidth + (event.clientX - state.startX), key),
    });
  };

  const endResize = (key: TableColKey) => {
    const state = resizeRef.current;
    if (!state || state.key !== key) return;
    setResize(null);
    // As vizinhas ficam com a largura medida; a arrastada vira a largura da
    // coluna e vai para as prefs.
    setMeasured((current) => ({ ...current, ...state.frozen, [key]: state.width }));
    // Clique sem mover nao grava: a coluna continua no automatico.
    if (state.width === state.startWidth) return;
    updatePrefs({ colWidths: { ...tablePrefs.colWidths, [key]: state.width } });
  };

  /** Teclado: setas andam 8px (Shift 32px). */
  const nudgeWidth = (key: TableColKey, delta: number) => {
    const state = resizeRef.current;
    const base = state && state.key === key ? state.width : explicitWidth(key) ?? fallbackWidth(key);
    const next = clampColWidth(base + delta, key);
    setMeasured((current) => ({ ...current, [key]: next }));
    updatePrefs({ colWidths: { ...tablePrefs.colWidths, [key]: next } });
  };

  /** Volta a coluna para o automatico (duplo clique ou Home). */
  const clearWidth = (key: TableColKey) => {
    const next = { ...tablePrefs.colWidths };
    delete next[key];
    setMeasured((current) => {
      const cleaned = { ...current };
      delete cleaned[key];
      return cleaned;
    });
    updatePrefs({ colWidths: next });
  };

  const toggleCol = (key: string) => {
    setTablePrefs((current) => {
      const cols = { ...current.cols };
      const k = key as keyof TableCols;
      if (cols[k]) {
        if (visibleOptionalCols.length <= 3) return current;
        cols[k] = false;
      } else {
        cols[k] = true;
      }
      return { ...current, cols };
    });
  };

  if (loading && !index) {
    return (
      <section className="pjx-root pjx-view--center dy-body">
        <p className="muted">
          <Spinner /> Carregando...
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="pjx-root pjx-view--center dy-body">
        <p className="error">{error}</p>
      </section>
    );
  }

  const emptyShape = (
    <div className="pjx-slotshape" role="status">
      <span />
      <span />
      <span />
      <span className="dy-label">sem sessões</span>
    </div>
  );

  return (
    <div className="pjx-root dy-body">
      <section className="pjx-view">
        <header className="pjx-head">
          <nav className="pjx-tabs" role="tablist" aria-label="Vistas de projetos">
            {paneKind ? (
              <button
                type="button"
                role="tab"
                id="pjx-tab-nota"
                className="dy-label"
                aria-selected={effectiveView === "nota"}
                onClick={() => setView("nota")}
              >
                Nota
              </button>
            ) : null}
            <button
              type="button"
              role="tab"
              id="pjx-tab-itens"
              className="dy-label"
              aria-selected={effectiveView === "itens"}
              onClick={() => setView("itens")}
            >
              Itens
              <span className="pjx-tabn">{filtered.length}</span>
            </button>
          </nav>
        </header>

        {effectiveView === "nota" && paneKind === "session" && sessionNode ? (
          <div className="pjx-note" role="tabpanel" aria-labelledby="pjx-tab-nota">
            <SessionPane sessionNode={sessionNode} onEdit={onOpenEntry} />
          </div>
        ) : effectiveView === "nota" && paneKind === "folder" && folderNode ? (
          <div className="pjx-note" role="tabpanel" aria-labelledby="pjx-tab-nota">
            <FolderPane
              folder={folderNode}
              onOpenSession={(id) => onSelectNode({ kind: "session", id })}
            />
          </div>
        ) : (
          <div className="pjx-items" role="tabpanel" aria-labelledby="pjx-tab-itens">
            {data.rows.length > 0 ? (
              <div className="pjx-toolbar">
                {filtersOpen ? (
                  <div className="pjx-filters">
                    <span className="pjx-chips">
                      {data.kinds.map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          className={`dy-label ${activeChip(kindFilter.has(kind))}`}
                          aria-pressed={kindFilter.has(kind)}
                          onClick={() => toggleSet(kind, setKindFilter, kindFilter)}
                        >
                          {kind}
                        </button>
                      ))}
                    </span>
                  </div>
                ) : null}
                <span className="pjx-push" />
                <span className="pjx-sep" aria-hidden="true" />
                <div className="pjx-seg" role="group" aria-label="Período">
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
                {searchOpen ? (
                  <label className="pjx-search">
                    <SearchGlyph />
                    <input
                      autoFocus
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          setSearch("");
                          setSearchOpen(false);
                        }
                      }}
                      placeholder="Buscar"
                      aria-label="Buscar itens"
                    />
                  </label>
                ) : (
                  <button
                    type="button"
                    className="pjx-iconbtn"
                    title="Buscar"
                    aria-label="Buscar itens"
                    onClick={() => setSearchOpen(true)}
                  >
                    <SearchGlyph />
                  </button>
                )}
                <button
                  type="button"
                  className={`pjx-iconbtn${filtersOpen ? " pjx-iconbtn--on" : ""}`}
                  title="Filtros"
                  aria-label="Mostrar filtros"
                  aria-pressed={filtersOpen}
                  onClick={() => setFiltersOpen((open) => !open)}
                >
                  <FilterGlyph />
                </button>
                <button
                  type="button"
                  className={`pjx-iconbtn${tablePrefs.customOpen ? " pjx-iconbtn--on" : ""}`}
                  title="Personalizar"
                  aria-label="Personalizar tabela"
                  aria-pressed={tablePrefs.customOpen}
                  onClick={toggleCustom}
                >
                  <SlidersGlyph />
                </button>
                <button
                  type="button"
                  className="pjx-iconbtn"
                  title="Restaurar"
                  aria-label="Restaurar padrao"
                  onClick={resetPrefs}
                >
                  <RefreshGlyph />
                </button>
                <div
                  className={`pjx-seg${narrow ? " pjx-seg--off" : ""}`}
                  role="group"
                  aria-label="Variante"
                  aria-disabled={narrow}
                >
                  <button                    type="button"
                          className="dy-label"
                    aria-pressed={!narrow && variant === "table"}
                    onClick={() => setVariant("table")}
                  >
                    Tabela
                  </button>
                  <button                    type="button"
                          className="dy-label"
                    aria-pressed={narrow || variant === "cards"}
                    onClick={() => setVariant("cards")}
                  >
                    Cartões
                  </button>
                </div>
              </div>
            ) : null}

            {tablePrefs.customOpen ? (
              <section className="pjx-custom">
                <div className="pjx-ctrl">
                  <span className="pjx-ctrl-lbl">Largura</span>
                  <div className="pjx-seg" role="group" aria-label="Largura">
                    <button                      type="button"
                            className="dy-label"
                      aria-pressed={tablePrefs.width === "contained"}
                      onClick={() => setWidth("contained")}
                    >
                      Contida
                    </button>
                    <button                      type="button"
                            className="dy-label"
                      aria-pressed={tablePrefs.width === "full"}
                      onClick={() => setWidth("full")}
                    >
                      Cheia
                    </button>
                  </div>
                </div>
                <div className="pjx-ctrl">
                  <span className="pjx-ctrl-lbl">Densidade</span>
                  <div className="pjx-seg" role="group" aria-label="Densidade">
                    <button                      type="button"
                            className="dy-label"
                      aria-pressed={tablePrefs.density === "compact"}
                      onClick={() => setDensity("compact")}
                    >
                      Compacta
                    </button>
                    <button                      type="button"
                            className="dy-label"
                      aria-pressed={tablePrefs.density === "comfortable"}
                      onClick={() => setDensity("comfortable")}
                    >
                      Confortável
                    </button>
                    <button                      type="button"
                            className="dy-label"
                      aria-pressed={tablePrefs.density === "wide"}
                      onClick={() => setDensity("wide")}
                    >
                      Ampla
                    </button>
                  </div>
                </div>
                <div className="pjx-ctrl pjx-menucols">
                  <span className="pjx-ctrl-lbl">Colunas</span>
                  <button
                    type="button"
                    className="dy-label pjx-chip"
                    onClick={() => setColsPanelOpen((open) => !open)}
                  >
                    Colunas
                  </button>
                  <div className="pjx-colspanel" hidden={!colsPanelOpen}>
                    {TABLE_COL_KEYS.map((key) => (
                      <label key={key}>
                        <input
                          type="checkbox"
                          checked={tablePrefs.cols[key as keyof TableCols]}
                          disabled={!canUncheckCol(key)}
                          onChange={() => toggleCol(key)}
                        />
                        {TABLE_COL_LABELS[key]}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="pjx-ctrl">
                  <span className="pjx-ctrl-lbl">Aparência</span>
                  <div className="pjx-seg" role="group" aria-label="Aparência">
                    <button                      type="button"
                            className="dy-label"
                      aria-pressed={tablePrefs.appearance === "lines"}
                      onClick={() => setAppearance("lines")}
                    >
                      Linhas
                    </button>
                    <button                      type="button"
                            className="dy-label"
                      aria-pressed={tablePrefs.appearance === "grade"}
                      onClick={() => setAppearance("grade")}
                    >
                      Grade
                    </button>
                    <button                      type="button"
                            className="dy-label"
                      aria-pressed={tablePrefs.appearance === "zebra"}
                      onClick={() => setAppearance("zebra")}
                    >
                      Zebra
                    </button>
                  </div>
                </div>
              </section>
            ) : null}

            {filtered.length === 0 ? (
              <div className="pjx-items-body pjx-items-body--center">{emptyShape}</div>
            ) : (
              <div className="pjx-items-body">
                <div
                  className={`pjx-tablewrap pjx-tablewrap--${tablePrefs.width}`}
                  data-width={tablePrefs.width}
                  data-density={tablePrefs.density}
                >
                  <div
                    className={`pjx-vtable ap-${tablePrefs.appearance} ${tablePrefs.appearance}${resize ? " pjx-resizing" : ""}`}
                    data-density={tablePrefs.density}
                    data-appearance={tablePrefs.appearance}
                    data-width={tablePrefs.width}
                    style={{ ["--rh" as string]: `${TABLE_DENSITY_VALUES[tablePrefs.density]}px` }}
                    hidden={!tableVisible}
                  >
                    <table style={tableWidth !== undefined ? { width: `${tableWidth}px` } : undefined}>
                      <colgroup>
                        {visibleColKeys.map((key) => {
                          const explicit = explicitWidth(key);
                          return (
                            <col
                              key={key}
                              className={key === "item" ? undefined : COL_CLASS[key]}
                              style={explicit !== undefined ? { width: `${explicit}px` } : undefined}
                              data-col={key}
                            />
                          );
                        })}
                      </colgroup>
                      <thead>
                        <tr>
                          {visibleColKeys.map((key) => {
                            const right = key === "data" || key === "commit";
                            const dragging = resize?.key === key;
                            const thClass = [right ? "pjx-num" : "", dragging ? "pjx-drag" : ""]
                              .filter(Boolean)
                              .join(" ");
                            return (
                              <th
                                key={key}
                                data-col={key}
                                className={["dy-label", thClass].filter(Boolean).join(" ")}
                              >
                                {TABLE_COL_LABELS[key]}
                                <span
                                  className={`pjx-resize${dragging ? " pjx-resize--on" : ""}`}
                                  role="separator"
                                  aria-orientation="vertical"
                                  aria-label={`Redimensionar ${TABLE_COL_LABELS[key]}`}
                                  aria-valuenow={effectiveWidth(key)}
                                  aria-valuemin={minWidthFor(key)}
                                  aria-valuemax={maxWidthFor(key)}
                                  tabIndex={0}
                                  onPointerDown={(event) => beginResize(key, event)}
                                  onPointerMove={(event) => moveResize(key, event)}
                                  onPointerUp={() => endResize(key)}
                                  onPointerCancel={() => endResize(key)}
                                  onDoubleClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    clearWidth(key);
                                  }}
                                  onKeyDown={(event) => {
                                    const step = event.shiftKey ? KEY_STEP_FAST : KEY_STEP;
                                    if (event.key === "ArrowLeft") {
                                      event.preventDefault();
                                      nudgeWidth(key, -step);
                                    } else if (event.key === "ArrowRight") {
                                      event.preventDefault();
                                      nudgeWidth(key, step);
                                    } else if (event.key === "Home") {
                                      event.preventDefault();
                                      clearWidth(key);
                                    }
                                  }}
                                />
                              </th>
                            );
                          })}
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
                            {(() => {
                              const visible = new Set(visibleOptionalCols);
                              const nodes: ReactNode[] = [];
                              for (const key of ["proj", "item", "kind", "data", "commit", "sess"] as const) {
                                if (key === "item") {
                                  nodes.push(
                                    <td key="item" title={row.title} className="dy-body">
                                      {row.title}
                                    </td>,
                                  );
                                } else if (visible.has(key)) {
                                  let v: ReactNode = null;
                                  if (key === "proj") {
                                    v = row.project;
                                  } else if (key === "kind") {
                                    v = <KindBadge kind={row.kind} />;
                                  } else if (key === "data") {
                                    v = shortDate(row.date);
                                  } else if (key === "commit") {
                                    v = commitCell(row);
                                  } else if (key === "sess") {
                                    v = row.host ?? "";
                                  }
                                  const right = key === "data" || key === "commit";
                                  const kindClass =
                                    key === "data" || key === "commit" ? "dy-mono" : key === "proj" || key === "sess" ? "dy-body" : undefined;
                                  nodes.push(
                                    <td
                                      key={key}
                                      className={[right ? "pjx-num" : "", kindClass ?? ""]
                                        .filter(Boolean)
                                        .join(" ") || undefined}
                                    >
                                      {v}
                                    </td>,
                                  );
                                }
                              }
                              return nodes;
                            })()}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="pjx-vcards" hidden={!cardsVisible}>
                  {filteredSessions.map((row) => (
                    <section className="pjx-sess" key={row.session.sessionId}>
                      <div className="pjx-ssh">
                        <b>{row.session.project}</b>
                        <span className="pjx-ssub">
                          · {shortDate(row.session.date)} · {row.session.host}
                        </span>
                        <span className="pjx-cnt">
                          {row.items.length} {row.items.length === 1 ? "item" : "itens"}
                        </span>
                      </div>
                      {row.items.map((item, at) => (
                        <div
                          className="pjx-ci"
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
                          <span className="pjx-kw">
                            <KindBadge kind={item.kind} />
                          </span>
                          <span className="pjx-tt" title={item.title}>
                            {item.title}
                          </span>
                          <span className="pjx-cc">{commitCell(item)}</span>
                        </div>
                      ))}
                    </section>
                  ))}
                </div>
              </div>
            )}

            <footer className="pjx-foot">
              <p>
                <span>
                  {filtered.length} {filtered.length === 1 ? "item" : "itens"} ·{" "}
                  {filteredProjects} {filteredProjects === 1 ? "projeto" : "projetos"}
                </span>
              </p>
            </footer>
          </div>
        )}
      </section>
    </div>
  );
}
