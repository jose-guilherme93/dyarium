import { useEffect, useRef, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { EmojiPicker } from "../components/EmojiPicker";
import { Spinner } from "../components/Status";
import { ChevronIcon, ExternalIcon, FilterIcon, RefreshIcon, SearchIcon, SlidersIcon } from "../components/icons";
import { ProjectMark } from "../components/ProjectList";
import type { LogItem } from "../../../mobile/src/core/projetoLog";
import type { ProjectAgg, ProjectsIndex } from "../lib/useProjectsIndex";
import type { ProjectsRange } from "../lib/actions";

/**
 * Superficie "Projetos" do caderno MCP (docs/projetos.md). Um notebook de
 * kind=mcp substitui a lista de notas: o corpo das entradas e lido pelo
 * modulo projetoLog e vira duas vistas, Itens (tabela/cartoes) e Projetos.
 * O prototipo aprovado (proto-resumos.html) e a fonte da verdade visual.
 *
 * A carga do indice nao mora mais aqui: o App chama useProjectsIndex uma vez
 * e passa o mesmo indice para esta vista e para a lista da sidebar. A
 * selecao de projeto tambem vive no App: a lista escolhe, a vista respeita.
 */

/** Pedido de filtro vindo de fora (nota do projeto): abre Itens filtrada. */
export interface ProjectsFilterRequest extends Record<string, unknown> {
  project: string;
  range: ProjectsRange;
  /** Muda a cada pedido; o mesmo filtro repetido precisa re-aplicar. */
  nonce: number;
}

export interface ProjectsViewProps {
  index: ProjectsIndex | null;
  loading: boolean;
  error: string;
  /** Projeto escolhido na lista da sidebar; null = todos. */
  selectedProject: string | null;
  /** Icones escolhidos nesta sessao (a escolha local vence a entry). */
  icons: Record<string, string>;
  /** Trocou icone: o App guarda a escolha e persiste na entry. */
  onChooseIcon: (entryId: string, icon: string) => void;
  /** Abre a nota do projeto no editor que ja existe; nao cria rota nova. */
  onOpenEntry: (entryId: string) => void;
  /** Filtro aplicado de fora (acao "Filtrar itens" da nota do projeto). */
  filterRequest?: ProjectsFilterRequest | null;
}

type TabId = "items" | "projects";
type RangeId = ProjectsRange;
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
/** Colunas que o usuario pode redimensionar arrastando a borda. */
type TableColKey = "proj" | "kind" | "data" | "commit" | "sess";
/** Arraste em andamento: onde comecou, a largura inicial e a largura viva. */
interface ResizeState {
  key: TableColKey;
  startX: number;
  startWidth: number;
  width: number;
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

const TABLE_PREFS_KEY = "dyarium.projetos.tabela";
const DEFAULT_TABLE_PREFS: TablePrefs = {
  width: "full",
  density: "comfortable",
  cols: { proj: true, kind: true, data: true, commit: true, sess: true },
  appearance: "grade",
  customOpen: false,
  colWidths: {},
};
const TABLE_COL_KEYS = ["proj", "kind", "data", "commit", "sess"] as const;
/** Limites do arraste: abaixo disso a coluna fica inutil, acima disso vira oleo. */
const MIN_COL_WIDTH = 56;
const MAX_COL_WIDTH = 640;
/** Espelhando as classes .pj-col-* do CSS: largura natural de cada coluna. */
const DEFAULT_COL_WIDTHS: Record<TableColKey, number> = {
  proj: 150,
  kind: 72,
  data: 72,
  commit: 110,
  sess: 96,
};
/** Passo do teclado: seta move 8px, com Shift 32px. */
const KEY_STEP = 8;
const KEY_STEP_FAST = 32;
/** A coluna Item nunca some: ela ganha o que sobra, mas nunca menos que isto. */
const ITEM_MIN_WIDTH = 140;

function clampColWidth(value: number): number {
  if (!Number.isFinite(value)) return MIN_COL_WIDTH;
  return Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, Math.round(value)));
}

const TABLE_COL_LABELS: Record<string, string> = {
  proj: "Projeto",
  kind: "Kind",
  data: "Data",
  commit: "Commit",
  sess: "Sessão",
};
const TABLE_DENSITY_VALUES: Record<TableDensity, { rh: number; fs: number }> = {
  compact: { rh: 28, fs: 12.5 },
  comfortable: { rh: 36, fs: 13.5 },
  wide: { rh: 44, fs: 14 },
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
    // restaura padrao
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
  for (const key of TABLE_COL_KEYS) {
    const value = widthsRaw[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      colWidths[key] = clampColWidth(value);
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

/** Dia como numero, para comparar datas sem nesta horario. */
/** Compara sem acento e sem caixa: a busca nao deve exigir o acerto exato. */
function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function dayNumber(date: string): number {  const parts = date.split("-").map(Number);
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

function KindBadge({ kind }: { kind: string }) {
  return <span className={`pj-kb ${KIND_CLASS[kind] ?? ""}`}>{kind}</span>;
}

interface PickerSpot {
  entryId: string;
  current: string;
  anchor: DOMRect;
}

export function ProjectsView({
  index,
  loading,
  error,
  selectedProject,
  icons,
  onChooseIcon,
  onOpenEntry,
  filterRequest,
}: ProjectsViewProps) {
  const [tab, setTab] = useState<TabId>("items");
  const [kindFilter, setKindFilter] = useState<Set<string>>(new Set());
  const [range, setRange] = useState<RangeId>("all");
  const [variant, setVariant] = useState<VariantId>("table");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [tablePrefs, setTablePrefs] = useState<TablePrefs>(loadTablePrefs);
  const [colsPanelOpen, setColsPanelOpen] = useState(false);
  const [openProjects, setOpenProjects] = useState<Record<string, boolean>>({});
  /** Janela estreita (<720px): so cartoes, e o segmento fica desabilitado. */
  const [narrow, setNarrow] = useState(() =>
    typeof window === "undefined" ? false : window.innerWidth <= 720,
  );
  const [picker, setPicker] = useState<PickerSpot | null>(null);
  /** Arraste de coluna em andamento: guarda a origem e a largura ao vivo. */
  const [resize, setResizeState] = useState<ResizeState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);

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

  // Filtro pedido de fora (nota do projeto): abre a aba Itens ja filtrada
  // pelo periodo da sessao. O projeto em si ja foi escolhido na lista da
  // sidebar pelo App; aqui só muda a vista e o periodo.
  useEffect(() => {
    if (!filterRequest) return;
    setTab("items");
    setRange(filterRequest.range);
  }, [filterRequest]);

  if (loading && !index) {
    return (
      <section className="pj-view pj-view--center">
        <p className="muted">
          <Spinner /> Carregando...
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="pj-view pj-view--center">
        <p className="error">{error}</p>
      </section>
    );
  }

  const data: ProjectsIndex = index ?? {
    rows: [],
    sessions: [],
    entries: [],
    entryByProject: {},
    kinds: [],
  };
  const projects: ProjectAgg[] = data.entries
    .filter((entry) => Boolean(entry.title))
    .map((entry) => ({
      project: entry.title,
      entryId: entry.id,
      icon: entry.icon ?? "",
      sessions: data.sessions.filter((row) => row.session.project === entry.title),
    }));

  // Filtro vigente: escopo da lista + chips de kind + periodo + busca.
  // Derivado por render, o indice pesado e construido uma vez so (no hook).
  const limit = range === "all" ? 0 : range === "7" ? 6 : 29;
  const keep = (row: { project: string; kind: string; date: string; title: string; commit?: string }) => {
    if (selectedProject && row.project !== selectedProject) return false;
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
  const filtered = data.rows.filter(keep);
  const filteredSessions = data.sessions
    .map((row) => ({ ...row, items: row.session.items.filter(keep) }))
    .filter((row) => row.items.length > 0);
  const filteredProjects = new Set(filtered.map((row) => row.project)).size;

  /** Icone de um projeto no estado atual (escolha local vence a entry). */
  const iconFor = (agg: ProjectAgg): string => icons[agg.entryId] || agg.icon || "";

  /** Icone pelo nome do projeto, para linhas de sessao (cartoes). */
  const iconForName = (project: string): string => {
    const agg = projects.find((p) => p.project === project);
    return agg ? iconFor(agg) : "";
  };

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

  /** Abre o seletor colado no botao de icone, como no prototipo. */
  const openPicker = (event: ReactMouseEvent<HTMLElement>, agg: ProjectAgg) => {
    event.stopPropagation();
    setPicker({
      entryId: agg.entryId,
      current: iconFor(agg),
      anchor: event.currentTarget.getBoundingClientRect(),
    });
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

  // Projeto escolhido: a coluna "Projeto" so repetiria o nome que ja esta
  // fixado na lista da sidebar; ela sai da tabela neste escopo.
  const visibleOptionalCols = TABLE_COL_KEYS.filter(
    (key) => tablePrefs.cols[key] && !(key === "proj" && selectedProject),
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
  const resetPrefs = () =>
    setTablePrefs({
      ...DEFAULT_TABLE_PREFS,
      cols: { ...DEFAULT_TABLE_PREFS.cols },
      colWidths: {},
    });

  // --- Redimensionamento de coluna ---------------------------------------
  // A largura vive nas prefs: o <col> recebe o valor e a coluna Item continua
  // no automatico, absorvendo o que sobrar.

  /** Largura em vigor da coluna: a salva, ou a natural quando nunca foi salva. */
  const widthOf = (key: TableColKey): number =>
    tablePrefs.colWidths[key] ?? DEFAULT_COL_WIDTHS[key];

  /** Largura aplicada agora: durante o arraste vale a do mouse. */
  const liveWidthOf = (key: TableColKey): number =>
    resize && resize.key === key ? resize.width : widthOf(key);

  /** A coluna Item nunca some: ela ganha o que sobra, mas nunca menos que isto. */
  const hasCustomWidth =
    resize !== null ||
    visibleOptionalCols.some((key) => tablePrefs.colWidths[key] !== undefined);
  /** Soma das colunas fixas: e o piso da tabela, para o scroll horizontal
   *  aparecer em vez de espremer a coluna Item ate zero. */
  const tableMinWidth = hasCustomWidth
    ? visibleOptionalCols.reduce((sum, key) => sum + liveWidthOf(key), 0) + ITEM_MIN_WIDTH
    : undefined;

  const setResize = (next: ResizeState | null) => {
    resizeRef.current = next;
    setResizeState(next);
  };

  const beginResize = (key: TableColKey, event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    // A largura real da coluna manda; o fallback cobre o teste sem layout.
    const th = event.currentTarget.closest("th");
    const measured = th ? th.getBoundingClientRect().width : 0;
    const startWidth = measured > 0 ? measured : widthOf(key);
    setResize({ key, startX: event.clientX, startWidth, width: startWidth });
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
      width: clampColWidth(state.startWidth + (event.clientX - state.startX)),
    });
  };

  const endResize = (key: TableColKey) => {
    const state = resizeRef.current;
    if (!state || state.key !== key) return;
    setResize(null);
    // Clique sem mover nao grava: a coluna continua no automatico.
    if (state.width === widthOf(key)) return;
    updatePrefs({ colWidths: { ...tablePrefs.colWidths, [key]: state.width } });
  };

  /** Teclado: setas andam 8px (Shift 32px). */
  const nudgeWidth = (key: TableColKey, delta: number) => {
    const state = resizeRef.current;
    const base = state && state.key === key ? state.width : widthOf(key);
    updatePrefs({ colWidths: { ...tablePrefs.colWidths, [key]: clampColWidth(base + delta) } });
  };

  /** Volta a coluna para o automatico (duplo clique ou Home). */
  const clearWidth = (key: TableColKey) => {
    const next = { ...tablePrefs.colWidths };
    delete next[key];
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

  const densityStyle = TABLE_DENSITY_VALUES[tablePrefs.density];

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
          <div className="pj-items" role="tabpanel" aria-labelledby="pj-tab-itens">
            {data.rows.length > 0 ? (
              <div className="pj-toolbar">
                {filtersOpen ? (
                  <div className="pj-filters">
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
                  </div>
                ) : null}
                <span className="pj-push" />
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
                {searchOpen ? (
                  <label className="pj-search">
                    <SearchIcon size={15} />
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
                    className="pj-iconbtn"
                    title="Buscar"
                    aria-label="Buscar itens"
                    onClick={() => setSearchOpen(true)}
                  >
                    <SearchIcon size={15} />
                  </button>
                )}
                <button
                  type="button"
                  className={`pj-iconbtn${filtersOpen ? " pj-iconbtn--on" : ""}`}
                  title="Filtros"
                  aria-label="Mostrar filtros"
                  aria-pressed={filtersOpen}
                  onClick={() => setFiltersOpen((open) => !open)}
                >
                  <FilterIcon size={15} />
                </button>
                <button
                  type="button"
                  className={`pj-iconbtn${tablePrefs.customOpen ? " pj-iconbtn--on" : ""}`}
                  title="Personalizar"
                  aria-label="Personalizar tabela"
                  aria-pressed={tablePrefs.customOpen}
                  onClick={toggleCustom}
                >
                  <SlidersIcon size={15} />
                </button>
                <button
                  type="button"
                  className="pj-iconbtn"
                  title="Restaurar"
                  aria-label="Restaurar padrao"
                  onClick={resetPrefs}
                >
                  <RefreshIcon size={15} />
                </button>
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

            {tablePrefs.customOpen ? (
              <section className="pj-custom">
                <div className="pj-ctrl">
                  <span className="pj-ctrl-lbl">Largura</span>
                  <div className="pj-seg" role="group" aria-label="Largura">
                    <button
                      type="button"
                      aria-pressed={tablePrefs.width === "contained"}
                      onClick={() => setWidth("contained")}
                    >
                      Contida
                    </button>
                    <button
                      type="button"
                      aria-pressed={tablePrefs.width === "full"}
                      onClick={() => setWidth("full")}
                    >
                      Cheia
                    </button>
                  </div>
                </div>
                <div className="pj-ctrl">
                  <span className="pj-ctrl-lbl">Densidade</span>
                  <div className="pj-seg" role="group" aria-label="Densidade">
                    <button
                      type="button"
                      aria-pressed={tablePrefs.density === "compact"}
                      onClick={() => setDensity("compact")}
                    >
                      Compacta
                    </button>
                    <button
                      type="button"
                      aria-pressed={tablePrefs.density === "comfortable"}
                      onClick={() => setDensity("comfortable")}
                    >
                      Confortável
                    </button>
                    <button
                      type="button"
                      aria-pressed={tablePrefs.density === "wide"}
                      onClick={() => setDensity("wide")}
                    >
                      Ampla
                    </button>
                  </div>
                </div>
                <div className="pj-ctrl pj-menucols">
                  <span className="pj-ctrl-lbl">Colunas</span>
                  <button
                    type="button"
                    className="pj-btn"
                    onClick={() => setColsPanelOpen((open) => !open)}
                  >
                    Colunas ▾
                  </button>
                  <div className="pj-colspanel" hidden={!colsPanelOpen}>
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
                <div className="pj-ctrl">
                  <span className="pj-ctrl-lbl">Aparência</span>
                  <div className="pj-seg" role="group" aria-label="Aparência">
                    <button
                      type="button"
                      aria-pressed={tablePrefs.appearance === "lines"}
                      onClick={() => setAppearance("lines")}
                    >
                      Linhas
                    </button>
                    <button
                      type="button"
                      aria-pressed={tablePrefs.appearance === "grade"}
                      onClick={() => setAppearance("grade")}
                    >
                      Grade
                    </button>
                    <button
                      type="button"
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
              <div className="pj-items-body pj-items-body--center">{emptyState}</div>
            ) : (
              <div className="pj-items-body">
                <div
                  className={`pj-tablewrap pj-tablewrap--${tablePrefs.width}`}
                  data-width={tablePrefs.width}
                  data-density={tablePrefs.density}
                >
                  <div
                    className={`pj-vtable ap-${tablePrefs.appearance} density-${tablePrefs.density} ${tablePrefs.appearance}${resize ? " pj-resizing" : ""}`}
                    data-density={tablePrefs.density}
                    data-densidade={tablePrefs.density}
                    data-d={tablePrefs.density}
                    data-appearance={tablePrefs.appearance}
                    data-width={tablePrefs.width}
                    style={{
                      ["--rh" as string]: `${densityStyle.rh}px`,
                      ["--fs" as string]: `${densityStyle.fs}px`,
                    }}
                    hidden={!tableVisible}
                  >
                    <table style={tableMinWidth ? { minWidth: tableMinWidth } : undefined}>
                      <colgroup>
                        {(() => {
                          const visible = new Set(visibleOptionalCols);
                          const nodes: ReactNode[] = [];
                          for (const key of ["proj", "item", "kind", "data", "commit", "sess"] as const) {
                            if (key === "item") {
                              nodes.push(<col key="item" />);
                            } else if (visible.has(key)) {
                              const cls =
                                key === "proj"
                                  ? "pj-col-pj"
                                  : key === "kind"
                                    ? "pj-col-k"
                                    : key === "data"
                                      ? "pj-col-d"
                                      : key === "commit"
                                        ? "pj-col-c"
                                        : "pj-col-s";
                              // Largura salva pelo usuario; sem ela a coluna fica
                              // no automatico da tabela.
                              const saved = tablePrefs.colWidths[key];
                              const applied = resize && resize.key === key ? resize.width : saved;
                              nodes.push(
                                <col
                                  key={key}
                                  className={cls}
                                  style={applied ? { width: applied } : undefined}
                                  data-col={key}
                                />,
                              );
                            }
                          }
                          return nodes;
                        })()}
                      </colgroup>
                      <thead>
                        <tr>
                          {(() => {
                            const visible = new Set(visibleOptionalCols);
                            const nodes: ReactNode[] = [];
                            for (const key of ["proj", "item", "kind", "data", "commit", "sess"] as const) {
                              if (key === "item") {
                                nodes.push(<th key="item">Item</th>);
                              } else if (visible.has(key)) {
                                const right = key === "data" || key === "commit";
                                const dragging = resize?.key === key;
                                nodes.push(
                                  <th key={key} className={right ? "pj-num" : undefined}>
                                    {TABLE_COL_LABELS[key]}
                                    <span
                                      className={`pj-resize${dragging ? " pj-resize--on" : ""}`}
                                      role="separator"
                                      aria-orientation="vertical"
                                      aria-label={`Redimensionar ${TABLE_COL_LABELS[key]}`}
                                      aria-valuenow={liveWidthOf(key)}
                                      aria-valuemin={MIN_COL_WIDTH}
                                      aria-valuemax={MAX_COL_WIDTH}
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
                                  </th>,
                                );
                              }
                            }
                            return nodes;
                          })()}
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
                                    <td key="item" title={row.title}>
                                      {row.title}
                                    </td>,
                                  );
                                } else if (visible.has(key)) {
                                  let v: ReactNode = null;
                                  if (key === "proj") {
                                    v = (
                                      <span className="pj-pcell">
                                        <ProjectMark icon={iconForName(row.project)} project={row.project} />
                                        {row.project}
                                      </span>
                                    );
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
                                  nodes.push(
                                    <td key={key} className={right ? "pj-num" : undefined}>
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
                <div className="pj-vcards" hidden={!cardsVisible}>
                  {filteredSessions.map((row) => (
                    <section className="pj-sess" key={row.session.sessionId}>
                      <div className="pj-ssh">
                        <ProjectMark
                          icon={iconForName(row.session.project)}
                          project={row.session.project}
                        />
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
              </div>
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
            {(selectedProject ? projects.filter((agg) => agg.project === selectedProject) : projects).map(
              (agg) => {
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
                // Projeto escolhido na lista: a superficie dele ja e expandida.
                const open = selectedProject ? true : Boolean(openProjects[agg.entryId]);
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
                        onClick={(event) => openPicker(event, agg)}
                      >
                        <ProjectMark icon={iconFor(agg)} project={agg.project} />
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
              },
            )}
          </div>
        ) : null}
      </section>

      {picker ? (
        <EmojiPicker
          anchor={picker.anchor}
          current={picker.current}
          onPick={(emoji) => {
            onChooseIcon(picker.entryId, emoji);
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </div>
  );
}
