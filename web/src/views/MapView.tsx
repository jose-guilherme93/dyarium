import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { FitIcon, InsightsIcon, PencilIcon, SearchIcon } from "../components/icons";
import { Spinner } from "../components/Status";
import {
  authorLabel,
  filterGraph,
  kindCounts,
  kindLabel,
  relativeRadius,
} from "../lib/graph";
import { drawGraphIcon, iconKeyFor, GRAPH_ICONS } from "../lib/graphIcons";
import { rippleWaves, RIPPLE_INTERVAL_MS, RIPPLE_TOTAL_MS } from "../lib/ripple";
import type {
  AuthorRole,
  EntityDetail,
  EntityKind,
  EntityMention,
  EntitySummary,
  GraphEdge,
  GraphNode,
  GraphResponse,
  Notebook,
  Settings,
} from "../types";
import { MoodView } from "./MoodView";

interface MapViewProps {
  refreshKey: number;
  onOpen: (id: string) => void;
  /** Entidade aberta a partir de uma nota; o mapa seleciona e centraliza. */
  focus?: { kind: EntityKind; name: string } | null;
  onFocusApplied?: () => void;
}

type Period = "all" | "12m" | "30d";
type InsightTab = EntityKind | "mood";

interface SimNode {
  id: string;
  kind: GraphNode["kind"];
  label: string;
  mentions: number;
  notes: number;
  sentiment?: number;
  last_seen?: string | null;
  date?: string | null;
  author?: AuthorRole;
  /** Icone monocromatico escolhido pelo dono; vazio usa o do tipo. */
  icon?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  fixed: boolean;
  /** Opacidade atual do rotulo, animada para entrar/sair sem saltos. */
  labelAlpha: number;
}

interface SimEdge {
  a: number;
  b: number;
  kind: GraphEdge["kind"];
  weight: number;
}

interface View {
  zoom: number;
  panX: number;
  panY: number;
}

interface Colors {
  paper: string;
  ink: string;
  line: string;
  accent: string;
  person: string;
  place: string;
  theme: string;
  decision: string;
  note: string;
  muted: string;
  font: string;
}

const KINDS: { id: GraphNode["kind"]; label: string }[] = [
  { id: "person", label: "Pessoas" },
  { id: "place", label: "Lugares" },
  { id: "theme", label: "Temas" },
  { id: "decision", label: "Decisões" },
  { id: "note", label: "Notas" },
];

const PERIODS: { id: Period; label: string }[] = [
  { id: "all", label: "Tudo" },
  { id: "12m", label: "12 meses" },
  { id: "30d", label: "30 dias" },
];

const INSIGHT_TABS: { id: InsightTab; label: string }[] = [
  { id: "person", label: "Pessoas" },
  { id: "place", label: "Lugares" },
  { id: "theme", label: "Temas" },
  { id: "decision", label: "Decisões" },
  { id: "mood", label: "Humor" },
];

function periodFrom(period: Period): string | undefined {
  if (period === "all") return undefined;
  const date = new Date();
  if (period === "12m") {
    date.setFullYear(date.getFullYear() - 1);
  } else {
    date.setDate(date.getDate() - 30);
  }
  return date.toISOString();
}

function readColors(): Colors {
  if (typeof window === "undefined") {
    return {
      paper: "#f6f4ef",
      ink: "#211e1a",
      line: "#ded8cc",
      accent: "#2c4a63",
      person: "#858c93",
      place: "#88918a",
      theme: "#96918a",
      decision: "#918b92",
      note: "#948f8a",
      muted: "#6b655c",
      font: "sans-serif",
    };
  }
  const styles = getComputedStyle(document.documentElement);
  const value = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  return {
    paper: value("--paper", "#f6f4ef"),
    ink: value("--ink", "#211e1a"),
    line: value("--line", "#ded8cc"),
    accent: value("--accent", "#2c4a63"),
    person: value("--graph-person", "#858c93"),
    place: value("--graph-place", "#88918a"),
    theme: value("--graph-theme", "#96918a"),
    decision: value("--graph-decision", "#918b92"),
    note: value("--graph-note", "#948f8a"),
    muted: value("--ink-soft", "#6b655c"),
    font: value("--font-sans", "sans-serif"),
  };
}

function kindColor(kind: GraphNode["kind"], colors: Colors): string {
  switch (kind) {
    case "person":
      return colors.person;
    case "place":
      return colors.place;
    case "theme":
      return colors.theme;
    case "decision":
      return colors.decision;
    case "note":
      return colors.note;
    default:
      return colors.ink;
  }
}

function IconPreview({ icon, size = 18 }: { icon: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const ink =
      getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#211e1a";
    drawGraphIcon(ctx, icon, size / 2, size / 2, size * 0.94, ink);
  }, [icon, size]);
  return <canvas ref={ref} className="map-icon-preview" style={{ width: size, height: size }} aria-hidden="true" />;
}

function iconSize(node: SimNode): number {
  if (node.kind === "user") return 28;
  if (node.kind === "note") return Math.min(10, node.r * 1.1);
  return Math.max(9, Math.min(16, node.r * 1.1));
}

const LABEL_FONT_SIZE = 11;
const LABEL_LINE_HEIGHT = 13;
const LABEL_MAX_WIDTH = 120;
const LABEL_GAP = 5;
const LABEL_CELL = 64;

interface ScreenBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  id?: string;
}

function addBox(grid: Map<string, ScreenBox[]>, box: ScreenBox): void {
  const x0 = Math.floor(box.x1 / LABEL_CELL);
  const x1 = Math.floor(box.x2 / LABEL_CELL);
  const y0 = Math.floor(box.y1 / LABEL_CELL);
  const y1 = Math.floor(box.y2 / LABEL_CELL);
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const key = `${x},${y}`;
      const list = grid.get(key);
      if (list) list.push(box);
      else grid.set(key, [box]);
    }
  }
}

function boxesOverlap(a: ScreenBox, b: ScreenBox): boolean {
  return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

function overlapsGrid(
  grid: Map<string, ScreenBox[]>,
  box: ScreenBox,
  ignoreId?: string,
): boolean {
  const x0 = Math.floor(box.x1 / LABEL_CELL);
  const x1 = Math.floor(box.x2 / LABEL_CELL);
  const y0 = Math.floor(box.y1 / LABEL_CELL);
  const y1 = Math.floor(box.y2 / LABEL_CELL);
  const seen = new Set<ScreenBox>();
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const list = grid.get(`${x},${y}`);
      if (!list) continue;
      for (const other of list) {
        if (seen.has(other)) continue;
        seen.add(other);
        if (ignoreId && other.id === ignoreId) continue;
        if (boxesOverlap(box, other)) return true;
      }
    }
  }
  return false;
}

/** Quebra em no maximo duas linhas pequenas; o resto vira reticencias. */
function wrapLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = '';
  for (let i = 0; i < words.length; i++) {
    const candidate = current ? `${current} ${words[i]}` : words[i];
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
    }
    if (lines.length >= 1) {
      let rest = words.slice(i).join(' ');
      while (rest && ctx.measureText(`${rest}…`).width > maxWidth) {
        rest = rest.slice(0, -1).trimEnd();
      }
      lines.push(rest ? `${rest}…` : '…');
      return lines;
    }
    if (ctx.measureText(words[i]).width <= maxWidth) {
      current = words[i];
      continue;
    }
    let clipped = words[i];
    while (clipped && ctx.measureText(`${clipped}…`).width > maxWidth) {
      clipped = clipped.slice(0, -1);
    }
    lines.push(`${clipped}…`);
    current = '';
  }
  if (current) lines.push(current);
  return lines.slice(0, 2);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "sem data";
  return new Date(value).toLocaleDateString("pt-BR");
}

/** Destaca a grafia que fez o trecho casar com a entidade. */
function highlightTerm(text: string, term: string) {
  if (!term) return text;
  const index = text.toLocaleLowerCase().indexOf(term.toLocaleLowerCase());
  if (index < 0) return text;
  return (
    <>
      {text.slice(0, index)}
      <strong className="map-mention-term">{text.slice(index, index + term.length)}</strong>
      {text.slice(index + term.length)}
    </>
  );
}

function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// MapView draws the relationship map on a canvas. The simulation is local and
// stops once it settles; the server only sends nodes and edges.
export function MapView({ refreshKey, onOpen, focus, onFocusApplied }: MapViewProps) {
  const [data, setData] = useState<GraphResponse | null>(null);
  const [graphVersion, setGraphVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [insightTab, setInsightTab] = useState<InsightTab>("person");
  // Cada clique numa bola reinicia a onda, mesmo quando ela ja esta escolhida.
  const [pulse, setPulse] = useState(0);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [notebookId, setNotebookId] = useState("");
  const [period, setPeriod] = useState<Period>("all");
  const [visible, setVisible] = useState<Record<GraphNode["kind"], boolean>>({
    person: true,
    place: true,
    theme: true,
    decision: true,
    note: true,
    user: true,
  });
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [mentions, setMentions] = useState<EntityMention[]>([]);
  const [mentionsLoading, setMentionsLoading] = useState(false);
  const [mentionsError, setMentionsError] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [claimSelf, setClaimSelf] = useState(false);
  const [mergeTarget, setMergeTarget] = useState("");
  const [mergeOptions, setMergeOptions] = useState<EntitySummary[]>([]);
  const [iconBusy, setIconBusy] = useState(false);
  const [iconError, setIconError] = useState("");
  const [iconOpen, setIconOpen] = useState(false);
  // Trocar o icone e cosmetico: nao refaz o grafo nem reenquadra o mapa.
  const [iconOverrides, setIconOverrides] = useState<Record<string, string>>({});
  const [renameError, setRenameError] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);

  /** Seleciona uma bola e reinicia a onda do destaque. */
  const selectNode = useCallback((id: string) => {
    setSelectedId(id);
    setPulse((value) => value + 1);
  }, []);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const iconBoxRef = useRef<HTMLDivElement | null>(null);
  // O hover tem canvas proprio: destacar uma bola nao redesenha o mapa todo.
  const hoverCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // A onda do no selecionado tem canvas proprio: animar nao redesenha o grafo.
  const rippleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rippleRafRef = useRef<number | null>(null);
  const simRef = useRef<{ nodes: SimNode[]; edges: SimEdge[]; pos: Map<string, { x: number; y: number }> } | null>(null);
  const viewRef = useRef<View>({ zoom: 1, panX: 0, panY: 0 });
  const sizeRef = useRef({ w: 0, h: 0 });
  const colorsRef = useRef<Colors>(readColors());
  const hoverRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const queryRef = useRef("");
  const labelWrapRef = useRef(new Map<string, string[]>());
  const rafRef = useRef<number | null>(null);
  // Animacao curta da camera ao recentralizar a bola principal.
  const viewAnimRef = useRef<number | null>(null);
  // Uma unica passada de rAF enquanto os rotulos entram/saem; ela para sozinha.
  const labelRafRef = useRef<number | null>(null);
  const drawRef = useRef<() => void>(() => undefined);
  const lastDragStepRef = useRef(0);
  const dragRef = useRef<{ id: string; moved: boolean; startX: number; startY: number } | null>(null);
  const panRef = useRef<{ x: number; y: number } | null>(null);
  // O navegador dispara `click` depois do pointerup; sem isso um arrasto abria o
  // detalhe da bola que estava embaixo do cursor ao soltar.
  const ignoreClickRef = useRef(false);
  const fitRef = useRef(true);
  const manualViewRef = useRef(false);
  // Um foco vindo de uma nota vale uma vez: nao reseleciona a cada filtro.
  const appliedFocusRef = useRef<string | null>(null);

  const kindSet = useMemo(() => {
    const set = new Set<GraphNode["kind"]>();
    for (const kind of KINDS) {
      if (visible[kind.id]) set.add(kind.id);
    }
    return set;
  }, [visible]);

  const filtered = useMemo(() => (data ? filterGraph(data, kindSet) : null), [data, kindSet]);
  const counts = useMemo(() => (data ? kindCounts(data) : {}), [data]);
  const insightEntities = useMemo(() => {
    if (!data || insightTab === "mood") return [];
    return data.nodes
      .filter((node) => node.kind === insightTab)
      .slice()
      .sort((a, b) => b.mentions - a.mentions || a.label.localeCompare(b.label));
  }, [data, insightTab]);
  const selectedNode = useMemo(() => {
    if (selectedId && selectedId === data?.center.id) return data.center;
    return filtered?.nodes.find((node) => node.id === selectedId) ?? null;
  }, [filtered, selectedId, data]);
  const selection = selectedNode ?? null;
  const noteNode = selection?.kind === "note" ? selection : null;
  const entityNode =
    selection && selection.kind !== "note" && selection.kind !== "user" ? selection : null;
  const entityIcon = entityNode
    ? (iconOverrides[entityNode.id] ?? entityNode.icon ?? "")
    : "";
  const hasNotes = Boolean(data?.nodes.some((node) => node.kind === "note"));
  const mentionGroups = useMemo(() => {
    const groups = new Map<
      string,
      { entryId: string; title: string; date: string | null; comment: string; items: EntityMention[] }
    >();
    for (const mention of mentions) {
      let group = groups.get(mention.entry_id);
      if (!group) {
        group = {
          entryId: mention.entry_id,
          title: mention.title,
          date: mention.date,
          comment: mention.comment ?? "",
          items: [],
        };
        groups.set(mention.entry_id, group);
      }
      if (!group.comment && mention.comment) {
        group.comment = mention.comment;
      }
      group.items.push(mention);
    }
    return [...groups.values()];
  }, [mentions]);
  const otherEntries = useMemo(() => {
    if (!detail) return [];
    const seen = new Set(mentionGroups.map((group) => group.entryId));
    return detail.entry_list.filter((entry) => !seen.has(entry.id));
  }, [detail, mentionGroups]);

  // Entidades do mesmo tipo para o "mesclar em" da renomeacao. Serve para
  // qualquer tipo: a IA pode extrair grafias diferentes da mesma pessoa, lugar,
  // tema ou decisao.
  useEffect(() => {
    if (!renameOpen || !entityNode) return;
    let cancelled = false;
    api
      .listEntities(entityNode.kind)
      .then((result) => {
        if (cancelled) return;
        const current = entityNode.label.toLowerCase();
        setMergeOptions(
          (result.entities ?? []).filter((item) => item.name.toLowerCase() !== current),
        );
      })
      .catch(() => {
        if (!cancelled) setMergeOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [renameOpen, entityNode]);

  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);
  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  // Load notebooks and the owner settings once. Settings only resolve the
  // author chip on note nodes; the map works without them.
  useEffect(() => {
    void api
      .listNotebooks()
      .then((result) => setNotebooks(result.notebooks ?? []))
      .catch(() => undefined);
    void api
      .getSettings()
      .then(setSettings)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getGraph({
        notebookId: notebookId || undefined,
        from: periodFrom(period),
        focus: focusId ?? undefined,
      })
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError("");
        if (focusId && result.nodes.some((node) => node.id === focusId)) {
          selectNode(focusId);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "falha ao carregar");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [notebookId, period, focusId, refreshKey, graphVersion, selectNode]);

  // Entity detail for the selected node. Notes and the user node already carry
  // everything the panel shows.
  useEffect(() => {
    if (!selectedNode || selectedNode.kind === "note" || selectedNode.kind === "user") {
      setDetail(null);
      setDetailError("");
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    api
      .getEntity(selectedNode.kind, selectedNode.label)
      .then((value) => {
        if (!cancelled) setDetail(value);
      })
      .catch((err: unknown) => {
        if (!cancelled) setDetailError(err instanceof Error ? err.message : "falha ao carregar");
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedNode]);

  useEffect(() => {
    setRenameOpen(false);
    setRenameValue("");
    setRenameError("");
    setIconOpen(false);
  }, [selectedId]);

  // Popover do icone: fecha ao clicar fora ou com Esc, sem criar um veu.
  useEffect(() => {
    if (!iconOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!iconBoxRef.current?.contains(event.target as Node)) setIconOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIconOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [iconOpen]);

  // Trechos reais da entidade: a passagem da transcricao (com o tempo) ou a
  // frase do texto, junto da leitura da analise daquela nota.
  const entityKind = entityNode?.kind;
  const entityName = entityNode?.label;
  useEffect(() => {
    if (!entityKind || !entityName) {
      setMentions([]);
      setMentionsError("");
      setMentionsLoading(false);
      return;
    }
    let cancelled = false;
    setMentions([]);
    setMentionsError("");
    setMentionsLoading(true);
    api
      .getEntityMentions(entityKind, entityName)
      .then((value) => {
        if (!cancelled) {
          setMentions(value.mentions ?? []);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setMentionsError(err instanceof Error ? err.message : "falha ao carregar os trechos");
        }
      })
      .finally(() => {
        if (!cancelled) setMentionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entityKind, entityName]);

  // Hover e desenhado numa camada separada. Mover o mouse entre bolas so
  // limpa/repinta algumas linhas; o mapa base nem e tocado. Sem hover, nenhuma
  // das duas camadas agenda frame.
  const drawHover = useCallback(() => {
    const canvas = hoverCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { w, h } = sizeRef.current;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const sim = simRef.current;
    const id = hoverRef.current;
    if (!sim || !id || w <= 0 || h <= 0) return;
    const node = sim.nodes.find((item) => item.id === id);
    if (!node) return;
    const view = viewRef.current;
    const colors = colorsRef.current;
    const scale = Math.max(0.7, view.zoom);
    ctx.save();
    ctx.translate(w / 2 + view.panX, h / 2 + view.panY);
    ctx.scale(view.zoom, view.zoom);
    if (node.kind === "user") {
      // A bola principal ja tem uma ligacao com todo mundo; acender todas de
      // novo viraria um estouro de linhas. Em vez disso, acende o que ja
      // existe entre as outras bolas: a malha de coocorrencias que mostra a
      // interconexao sem inventar um novo leque saindo do centro.
      for (const dashed of [false, true]) {
        ctx.beginPath();
        for (const edge of sim.edges) {
          const a = sim.nodes[edge.a];
          const b = sim.nodes[edge.b];
          if (!a || !b || a.id === id || b.id === id) continue;
          if ((edge.kind === "mention") !== dashed) continue;
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
        ctx.setLineDash(dashed ? [4 / view.zoom, 4 / view.zoom] : []);
        ctx.globalAlpha = dashed ? 0.3 : 0.34;
        ctx.strokeStyle = colors.muted;
        ctx.lineWidth = 1 / scale;
        ctx.stroke();
      }
      ctx.setLineDash([]);
    } else {
      for (const edge of sim.edges) {
        const a = sim.nodes[edge.a];
        const b = sim.nodes[edge.b];
        if (!a || !b || (a.id !== id && b.id !== id)) continue;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.setLineDash(edge.kind === "mention" ? [5 / view.zoom, 4 / view.zoom] : []);
        ctx.globalAlpha = edge.kind === "mention" ? 0.8 : 0.68;
        ctx.strokeStyle = colors.ink;
        ctx.lineWidth = (edge.kind === "mention" ? 1.7 : 1.5) / scale;
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.r + 4 / scale, 0, Math.PI * 2);
    ctx.strokeStyle = colors.ink;
    ctx.lineWidth = 1.3 / scale;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
    ctx.fillStyle = kindColor(node.kind, colors);
    ctx.fill();
    ctx.lineWidth = 1.9 / scale;
    ctx.strokeStyle = colors.ink;
    ctx.stroke();
    ctx.globalAlpha = 1;
    drawGraphIcon(
      ctx,
      iconKeyFor(node.kind, node.icon),
      node.x,
      node.y,
      iconSize(node),
      node.kind === "user" ? colors.paper : colors.ink,
    );
    ctx.restore();

    const sx = w / 2 + view.panX + node.x * view.zoom;
    const sy = h / 2 + view.panY + node.y * view.zoom;
    const sr = node.r * view.zoom;
    ctx.font = `${LABEL_FONT_SIZE}px ${colors.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const cacheKey = `${colors.font}|${node.label || "sem título"}`;
    let lines = labelWrapRef.current.get(cacheKey);
    if (!lines) {
      lines = wrapLabel(ctx, node.label || "sem título", LABEL_MAX_WIDTH);
      labelWrapRef.current.set(cacheKey, lines);
    }
    const y1 = sy + sr + LABEL_GAP;
    ctx.globalAlpha = 1;
    ctx.lineWidth = 3;
    ctx.strokeStyle = colors.paper;
    ctx.fillStyle = colors.ink;
    for (let i = 0; i < lines.length; i++) {
      const lineY = y1 + i * LABEL_LINE_HEIGHT;
      ctx.strokeText(lines[i], sx, lineY);
      ctx.fillText(lines[i], sx, lineY);
    }
  }, []);

  const cancelViewAnim = useCallback(() => {
    if (viewAnimRef.current !== null) {
      window.cancelAnimationFrame(viewAnimRef.current);
      viewAnimRef.current = null;
    }
  }, []);

  const setHovered = useCallback(
    (next: string | null) => {
      if (next === hoverRef.current) return;
      hoverRef.current = next;
      drawHover();
    },
    [drawHover],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const sim = simRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h } = sizeRef.current;
    if (w <= 0 || h <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const colors = colorsRef.current;
    const view = viewRef.current;
    const selected = selectedRef.current;
    const q = queryRef.current.trim().toLowerCase();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2 + view.panX, h / 2 + view.panY);
    ctx.scale(view.zoom, view.zoom);

    if (!sim) {
      ctx.restore();
      drawHover();
      return;
    }
    const nodes = sim.nodes;
    const matched = new Set<string>();
    if (q) {
      for (const node of nodes) {
        if (node.label.toLowerCase().includes(q)) matched.add(node.id);
      }
    }
    const isHighlighted = (id: string) => !q || matched.has(id);
    const centerNode = nodes.find((node) => node.kind === "user");
    // As bolas grandes mostram as proprias ligacoes sem hover; o resto segue
    // quase invisivel para o mapa nao virar uma teia.
    const major = new Set<string>();
    if (centerNode) major.add(centerNode.id);
    for (const node of nodes
      .filter((node) => node.kind !== "user")
      .slice()
      .sort((a, b) => b.r - a.r)
      .slice(0, 12)) {
      major.add(node.id);
    }

    for (const edge of sim.edges) {
      const a = nodes[edge.a];
      const b = nodes[edge.b];
      if (!a || !b) continue;
      // O hover mora na camada de cima; aqui o mapa e sempre o mesmo.
      const strong = isHighlighted(a.id) && isHighlighted(b.id);
      const majorEdge = major.has(a.id) || major.has(b.id);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      if (edge.kind === "mention") {
        ctx.setLineDash([5 / view.zoom, 4 / view.zoom]);
      } else {
        ctx.setLineDash([]);
      }
      const base = edge.kind === "cooccurrence" ? 0.08 : edge.kind === "mention" ? 0.42 : 0.16;
      const baseline = majorEdge ? Math.max(base, 0.22) : base;
      ctx.globalAlpha = strong ? Math.min(0.34, baseline + edge.weight * 0.025) : 0.04;
      ctx.strokeStyle = majorEdge ? colors.muted : colors.line;
      const width =
        edge.kind === "mention"
          ? 1.35
          : edge.kind === "cooccurrence"
            ? 0.5 + Math.min(1.1, edge.weight * 0.1)
            : 0.8 + Math.min(1.4, edge.weight * 0.12);
      ctx.lineWidth = (majorEdge ? Math.max(1, width) : width) / Math.max(0.65, view.zoom);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Circles first, center last so the diarist is never buried under a
    // busier entity. Labels are a second pass in screen space.
    for (const node of nodes) {
      if (node.kind === "user") continue;
      const color = kindColor(node.kind, colors);
      const highlighted = isHighlighted(node.id);
      const active = node.id === selected;
      ctx.globalAlpha = highlighted ? (active ? 0.95 : 0.72) : 0.12;
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = (active ? 2 : 1.1) / Math.max(0.7, view.zoom);
      ctx.strokeStyle = active ? colors.ink : colors.paper;
      ctx.stroke();
      drawGraphIcon(
        ctx,
        iconKeyFor(node.kind, node.icon),
        node.x,
        node.y,
        iconSize(node),
        colors.ink,
      );
      if (active) {
        // Anel persistente: a bola continua marcada depois que a onda passa.
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r + 5 / Math.max(0.7, view.zoom), 0, Math.PI * 2);
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 1.4 / Math.max(0.7, view.zoom);
        ctx.stroke();
      }
    }
    if (centerNode) {
      ctx.globalAlpha = isHighlighted(centerNode.id) ? 0.55 : 0.15;
      ctx.beginPath();
      ctx.arc(centerNode.x, centerNode.y, centerNode.r, 0, Math.PI * 2);
      ctx.fillStyle = colors.ink;
      ctx.fill();
      ctx.lineWidth = 2.2 / Math.max(0.7, view.zoom);
      ctx.strokeStyle = colors.paper;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(centerNode.x, centerNode.y, centerNode.r + 7 / view.zoom, 0, Math.PI * 2);
      ctx.globalAlpha = isHighlighted(centerNode.id) ? 0.55 : 0.1;
      ctx.strokeStyle = colors.muted;
      ctx.lineWidth = 1 / Math.max(0.7, view.zoom);
      ctx.stroke();
      ctx.globalAlpha = isHighlighted(centerNode.id) ? 1 : 0.2;
      drawGraphIcon(ctx, "person", centerNode.x, centerNode.y, iconSize(centerNode), colors.paper);
      if (selected === centerNode.id) {
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(centerNode.x, centerNode.y, centerNode.r + 12 / view.zoom, 0, Math.PI * 2);
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 1.4 / Math.max(0.7, view.zoom);
        ctx.stroke();
      }
    }

    ctx.globalAlpha = 1;
    ctx.restore();

    // Labels are measured in screen space: fixed readable size, up to two
    // lines, collision-aware, each one with its own opacity. O fade so roda
    // enquanto ha transicao; parado, nao existe frame nenhum.
    const screen = new Map<string, { sx: number; sy: number; sr: number }>();
    const nodeGrid = new Map<string, ScreenBox[]>();
    for (const node of nodes) {
      const sx = w / 2 + view.panX + node.x * view.zoom;
      const sy = h / 2 + view.panY + node.y * view.zoom;
      const sr = node.r * view.zoom;
      screen.set(node.id, { sx, sy, sr });
      addBox(nodeGrid, { x1: sx - sr, y1: sy - sr, x2: sx + sr, y2: sy + sr, id: node.id });
    }
    ctx.font = `${LABEL_FONT_SIZE}px ${colors.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const labelCandidates: SimNode[] = [];
    const labelSeen = new Set<string>();
    const addLabel = (node: SimNode | undefined) => {
      if (!node || labelSeen.has(node.id)) return;
      labelSeen.add(node.id);
      labelCandidates.push(node);
    };
    addLabel(centerNode);
    addLabel(nodes.find((node) => node.id === selected));
    for (const node of nodes.slice().sort((a, b) => b.r - a.r)) {
      addLabel(node);
    }
    const labelGrid = new Map<string, ScreenBox[]>();
    let settling = false;
    for (const node of labelCandidates) {
      const pos = screen.get(node.id);
      if (!pos) continue;
      const forced = node.id === centerNode?.id || node.id === selected;
      const highlighted = node.kind === "user" || isHighlighted(node.id);
      const cacheKey = `${colors.font}|${node.label || "sem título"}`;
      let lines = labelWrapRef.current.get(cacheKey);
      if (!lines) {
        lines = wrapLabel(ctx, node.label || "sem título", LABEL_MAX_WIDTH);
        labelWrapRef.current.set(cacheKey, lines);
      }
      if (lines.length === 0) continue;
      const width = Math.max(...lines.map((line) => ctx.measureText(line).width));
      const height = lines.length * LABEL_LINE_HEIGHT;
      const x1 = pos.sx - width / 2 - 2;
      const x2 = pos.sx + width / 2 + 2;
      const y1 = pos.sy + pos.sr + LABEL_GAP;
      const y2 = y1 + height;
      const box: ScreenBox = { x1, y1, x2, y2 };
      const inside = x1 >= 4 && x2 <= w - 4 && y1 >= 4 && y2 <= h - 4;
      const fits =
        highlighted &&
        inside &&
        (forced ||
          (!overlapsGrid(labelGrid, box) && !overlapsGrid(nodeGrid, box, node.id)));
      const target = fits ? 1 : 0;
      node.labelAlpha += (target - node.labelAlpha) * 0.18;
      if (Math.abs(target - node.labelAlpha) > 0.02) settling = true;
      if (node.labelAlpha < 0.02) continue;
      if (fits) addBox(labelGrid, box);
      ctx.globalAlpha = node.labelAlpha * (forced ? 1 : 0.86);
      ctx.lineWidth = 3;
      ctx.strokeStyle = colors.paper;
      ctx.fillStyle = colors.ink;
      for (let i = 0; i < lines.length; i++) {
        const lineY = y1 + i * LABEL_LINE_HEIGHT;
        ctx.strokeText(lines[i], pos.sx, lineY);
        ctx.fillText(lines[i], pos.sx, lineY);
      }
    }
    ctx.globalAlpha = 1;
    if (settling && labelRafRef.current === null) {
      labelRafRef.current = window.requestAnimationFrame(() => {
        labelRafRef.current = null;
        drawRef.current();
      });
    }
    drawHover();
  }, [drawHover]);

  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  const animateView = useCallback(
    (panX: number, panY: number, duration = 650) => {
      cancelViewAnim();
      const startX = viewRef.current.panX;
      const startY = viewRef.current.panY;
      const dx = panX - startX;
      const dy = panY - startY;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      const reduce =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) {
        viewRef.current.panX = panX;
        viewRef.current.panY = panY;
        draw();
        return;
      }
      const started = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - started) / duration);
        // easeInOutCubic: sai devagar, cruza rapido e chega devagar.
        const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        const view = viewRef.current;
        view.panX = startX + dx * eased;
        view.panY = startY + dy * eased;
        draw();
        if (t < 1) {
          viewAnimRef.current = window.requestAnimationFrame(step);
        } else {
          viewAnimRef.current = null;
        }
      };
      viewAnimRef.current = window.requestAnimationFrame(step);
    },
    [cancelViewAnim, draw],
  );


  // fitView frames the whole visible graph. The first layout fits itself; after
  // the user zooms or pans, the map stays where they put it.
  const fitView = useCallback(() => {
    cancelViewAnim();
    const sim = simRef.current;
    const { w, h } = sizeRef.current;
    if (!sim || sim.nodes.length === 0 || w <= 0 || h <= 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of sim.nodes) {
      minX = Math.min(minX, node.x - node.r);
      minY = Math.min(minY, node.y - node.r);
      maxX = Math.max(maxX, node.x + node.r);
      maxY = Math.max(maxY, node.y + node.r);
    }
    const pad = 54;
    const dx = Math.max(1, maxX - minX);
    const dy = Math.max(1, maxY - minY);
    const zoom = Math.max(0.35, Math.min(1.8, Math.min((w - pad * 2) / dx, (h - pad * 2) / dy)));
    viewRef.current = {
      zoom,
      panX: -((minX + maxX) / 2) * zoom,
      panY: -((minY + maxY) / 2) * zoom,
    };
    manualViewRef.current = false;
    draw();
  }, [cancelViewAnim, draw]);

  // Theme can change while the page is open. The canvas reads CSS variables,
  // so refresh the cached colors and redraw.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      colorsRef.current = readColors();
      draw();
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [draw]);

  // Selection, search and hover are visual only: redraw without rebuilding the
  // simulation.
  useEffect(() => {
    draw();
  }, [selectedId, query, draw]);

  // Enquanto houver bola selecionada, sai uma rajada de aneis a cada 3 s para
  // ela chamar atencao no meio do grafo. A camada e propria e so a onda e
  // redesenhada; o mapa continua parado.
  useEffect(() => {
    const canvas = rippleCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (rippleRafRef.current !== null) {
      window.cancelAnimationFrame(rippleRafRef.current);
      rippleRafRef.current = null;
    }
    const clear = () => {
      if (!canvas || !ctx) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, sizeRef.current.w, sizeRef.current.h);
    };
    clear();
    if (!selectedId || !canvas || !ctx) return;

    const paint = (elapsed: number) => {
      const { w, h } = sizeRef.current;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const sim = simRef.current;
      if (!sim || w <= 0 || h <= 0) return;
      const node = sim.nodes.find((item) => item.id === selectedId);
      if (!node) return;
      const view = viewRef.current;
      const sx = w / 2 + view.panX + node.x * view.zoom;
      const sy = h / 2 + view.panY + node.y * view.zoom;
      const base = Math.max(3, node.r * view.zoom) + 5;
      const colors = colorsRef.current;
      for (const wave of rippleWaves(elapsed, base)) {
        ctx.globalAlpha = wave.alpha;
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = wave.lineWidth;
        ctx.beginPath();
        ctx.arc(sx, sy, wave.radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    let raf: number | null = null;
    const burst = () => {
      if (raf !== null) {
        window.cancelAnimationFrame(raf);
        raf = null;
      }
      const started = performance.now();
      const step = (now: number) => {
        const elapsed = now - started;
        paint(elapsed);
        if (elapsed < RIPPLE_TOTAL_MS) {
          raf = window.requestAnimationFrame(step);
          rippleRafRef.current = raf;
        } else {
          raf = null;
          rippleRafRef.current = null;
          // Ultimo quadro: limpa os aneis e deixa so o anel fixo do mapa.
          paint(RIPPLE_TOTAL_MS);
        }
      };
      raf = window.requestAnimationFrame(step);
      rippleRafRef.current = raf;
    };

    burst();
    const timer = window.setInterval(burst, RIPPLE_INTERVAL_MS);
    return () => {
      if (raf !== null) window.cancelAnimationFrame(raf);
      window.clearInterval(timer);
      if (rippleRafRef.current !== null) {
        window.cancelAnimationFrame(rippleRafRef.current);
        rippleRafRef.current = null;
      }
      clear();
    };
  }, [selectedId, pulse]);

  // One physics pass, shared by the synchronous pre-settle, the drag and the
  // short settle after a node is dropped. It never runs while the map is idle.
  // Opening the map settles before the first frame, so the circles never jump
  // around for two seconds.
  const simStep = useCallback((sim: { nodes: SimNode[]; edges: SimEdge[]; pos: Map<string, { x: number; y: number }> }) => {
    const nodes = sim.nodes;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      if (a.fixed) continue;
      for (let j = 0; j < nodes.length; j++) {
        if (i === j) continue;
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d2 = 1;
        }
        const strength = a.kind === "user" || b.kind === "user" ? 10000 : 5200;
        const force = strength / Math.max(d2, 2500);
        const inv = 1 / Math.sqrt(d2);
        a.vx += dx * inv * force;
        a.vy += dy * inv * force;
      }
    }
    for (const edge of sim.edges) {
      const a = nodes[edge.a];
      const b = nodes[edge.b];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const target = a.r + b.r + (edge.kind === "cooccurrence" ? 120 : 100);
      const force = (dist - target) * (edge.kind === "cooccurrence" ? 0.005 : 0.009);
      const ux = dx / dist;
      const uy = dy / dist;
      if (!a.fixed) {
        a.vx += ux * force;
        a.vy += uy * force;
      }
      if (!b.fixed) {
        b.vx -= ux * force;
        b.vy -= uy * force;
      }
    }
    const anchor = nodes[0]?.kind === "user" ? nodes[0] : null;
    const anchorX = anchor?.x ?? 0;
    const anchorY = anchor?.y ?? 0;
    for (const node of nodes) {
      if (node.fixed) {
        node.vx = 0;
        node.vy = 0;
        sim.pos.set(node.id, { x: node.x, y: node.y });
        continue;
      }
      node.vx += (anchorX - node.x) * 0.0008;
      node.vy += (anchorY - node.y) * 0.0008;
      node.vx *= 0.87;
      node.vy *= 0.87;
      const speed = Math.hypot(node.vx, node.vy);
      if (speed > 24) {
        node.vx *= 24 / speed;
        node.vy *= 24 / speed;
      }
      node.x += node.vx;
      node.y += node.vy;
      sim.pos.set(node.id, { x: node.x, y: node.y });
    }
  }, []);

  // Parado, o mapa nao agenda frame nenhum. O respiro e uma animacao CSS no
  // proprio canvas (GPU/compositor), sem forca, sem colisao e sem recalcular
  // posicao: nada muda de lugar e nenhuma bola encosta na outra.

  const startSimulation = useCallback(
    (budget = 220, passes = 2) => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
      let left = budget;
      const step = () => {
        const sim = simRef.current;
        if (!sim) {
          rafRef.current = null;
          return;
        }
        for (let pass = 0; pass < passes && left > 0; pass++) {
          left--;
          simStep(sim);
        }
        draw();
        if (left > 0) {
          rafRef.current = window.requestAnimationFrame(step);
        } else {
          rafRef.current = null;
          if (fitRef.current) {
            fitRef.current = false;
            fitView();
          }
        }
      };
      rafRef.current = window.requestAnimationFrame(step);
    },
    [draw, fitView, simStep],
  );

  /** Seleciona uma entidade e leva a camera ate ela, sem refazer o grafo. */
  const selectEntity = useCallback(
    (node: GraphNode) => {
      if (!visible[node.kind]) {
        setVisible((current) => ({ ...current, [node.kind]: true }));
      }
      selectNode(node.id);
      const simNode = simRef.current?.nodes.find((item) => item.id === node.id);
      if (!simNode) return;
      fitRef.current = false;
      manualViewRef.current = true;
      const view = viewRef.current;
      animateView(-simNode.x * view.zoom, -simNode.y * view.zoom, 450);
    },
    [visible, animateView, selectNode],
  );

  // Build the simulation whenever the data or the visible kinds change. Old
  // positions are reused, so a refresh or a filter change does not scramble
  // the map.
  useEffect(() => {
    if (!filtered || !data) {
      simRef.current = null;
      draw();
      return;
    }
    const previous = simRef.current?.pos ?? new Map<string, { x: number; y: number }>();
    const entities = filtered.nodes.filter((node) => node.kind !== "note");
    const maxMentions = entities.reduce((max, node) => Math.max(max, node.mentions), 1);
    const previousCenter = previous.get(data.center.id);
    const center: SimNode = {
      id: data.center.id,
      kind: "user",
      label: data.center.label,
      mentions: 0,
      notes: data.total_edges,
      x: previousCenter?.x ?? 0,
      y: previousCenter?.y ?? 0,
      vx: 0,
      vy: 0,
      // Sempre maior que qualquer entidade, inclusive a campea de mencoes.
      r: Math.max(36, relativeRadius(maxMentions, maxMentions) * 1.35),
      fixed: true,
      labelAlpha: 0,
    };
    const nodes: SimNode[] = [center];
    let entityIndex = 0;
    let noteIndex = 0;
    for (const node of filtered.nodes) {
      const prior = previous.get(node.id);
      let x: number;
      let y: number;
      if (prior) {
        x = prior.x;
        y = prior.y;
      } else if (node.id === focusId) {
        x = 0;
        y = -90;
      } else if (node.kind === "note") {
        const angle = noteIndex++ * 2.399963;
        x = Math.cos(angle) * 260;
        y = Math.sin(angle) * 260;
      } else {
        const angle = entityIndex++ * 2.399963;
        const spread = 150 + 18 * Math.sqrt(entityIndex);
        x = Math.cos(angle) * spread;
        y = Math.sin(angle) * spread;
      }
      nodes.push({
        id: node.id,
        kind: node.kind,
        label: node.label,
        mentions: node.mentions,
        notes: node.notes,
        sentiment: node.sentiment,
        last_seen: node.last_seen,
        date: node.date,
        author: node.author,
        icon: node.icon,
        x,
        y,
        vx: 0,
        vy: 0,
        r: node.kind === "note" ? 7 : relativeRadius(node.mentions, maxMentions),
        fixed: false,
        labelAlpha: 0,
      });
    }
    const index = new Map(nodes.map((node, i) => [node.id, i]));
    const edges: SimEdge[] = [];
    for (const edge of filtered.edges) {
      const a = index.get(edge.source);
      const b = index.get(edge.target);
      if (a === undefined || b === undefined) continue;
      edges.push({ a, b, kind: edge.kind, weight: edge.weight });
    }
    const pos = new Map(previous);
    for (const node of nodes) pos.set(node.id, { x: node.x, y: node.y });
    simRef.current = { nodes, edges, pos };
    fitRef.current = false;
    manualViewRef.current = false;
    // Pre-settle synchronously: the first frame already shows the final layout.
    for (let i = 0; i < 280; i++) simStep(simRef.current);
    fitView();
    draw();
  }, [filtered, data, focusId, simStep, draw, fitView]);

  // Uma entidade aberta numa nota chega aqui: o mapa acende e centraliza a
  // bola correspondente. O foco vale uma vez e e devolvido ao App.
  useEffect(() => {
    if (!focus || !data) return;
    const key = `${focus.kind}:${focus.name.toLocaleLowerCase()}`;
    if (appliedFocusRef.current === key) return;
    const node = data.nodes.find(
      (item) =>
        item.kind === focus.kind &&
        item.label.toLocaleLowerCase() === focus.name.toLocaleLowerCase(),
    );
    if (!node) return;
    appliedFocusRef.current = key;
    setInsightTab(focus.kind);
    selectEntity(node);
    onFocusApplied?.();
  }, [focus, data, selectEntity, onFocusApplied]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      sizeRef.current = { w, h };
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      const hoverCanvas = hoverCanvasRef.current;
      if (hoverCanvas) {
        hoverCanvas.width = Math.max(1, Math.round(w * dpr));
        hoverCanvas.height = Math.max(1, Math.round(h * dpr));
      }
      const rippleCanvas = rippleCanvasRef.current;
      if (rippleCanvas) {
        rippleCanvas.width = Math.max(1, Math.round(w * dpr));
        rippleCanvas.height = Math.max(1, Math.round(h * dpr));
      }
      if (manualViewRef.current) {
        draw();
      } else {
        fitView();
      }
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [draw, fitView]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      if (labelRafRef.current !== null) window.cancelAnimationFrame(labelRafRef.current);
      if (viewAnimRef.current !== null) window.cancelAnimationFrame(viewAnimRef.current);
      if (rippleRafRef.current !== null) window.cancelAnimationFrame(rippleRafRef.current);
    };
  }, []);

  // Wheel zoom is a native listener because React's wheel handler is passive.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      cancelViewAnim();
      const rect = canvas.getBoundingClientRect();
      const view = viewRef.current;
      const scale = sizeRef.current.w > 0 ? rect.width / sizeRef.current.w : 1;
      // Trackpads and mice send different delta scales; clamp and use a small
      // exponential so one wheel notch does not jump the whole map.
      const delta =
        event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 100 : event.deltaY;
      const factor = Math.exp(-Math.max(-120, Math.min(120, delta)) * 0.00035);
      const zoom = Math.max(0.35, Math.min(3.5, view.zoom * factor));
      const px = (event.clientX - rect.left) / scale;
      const py = (event.clientY - rect.top) / scale;
      const cx = sizeRef.current.w / 2 + view.panX;
      const cy = sizeRef.current.h / 2 + view.panY;
      const gx = (px - cx) / view.zoom;
      const gy = (py - cy) / view.zoom;
      view.panX = px - sizeRef.current.w / 2 - gx * zoom;
      view.panY = py - sizeRef.current.h / 2 - gy * zoom;
      view.zoom = zoom;
      draw();
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [cancelViewAnim, draw]);

  const graphPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const view = viewRef.current;
    // O canvas recebe uma animacao CSS de escala no estado ocioso; dividir pela
    // escala exibida mantem o picking exato mesmo durante o respiro.
    const scale = sizeRef.current.w > 0 ? rect.width / sizeRef.current.w : 1;
    const px = (event.clientX - rect.left) / scale;
    const py = (event.clientY - rect.top) / scale;
    return {
      x: (px - (sizeRef.current.w / 2 + view.panX)) / view.zoom,
      y: (py - (sizeRef.current.h / 2 + view.panY)) / view.zoom,
    };
  };

  const pickNode = (x: number, y: number): SimNode | null => {
    const nodes = simRef.current?.nodes ?? [];
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      const radius = node.r + 5 / Math.max(0.7, viewRef.current.zoom);
      if (Math.hypot(x - node.x, y - node.y) <= radius) return node;
    }
    return null;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    ignoreClickRef.current = false;
    lastDragStepRef.current = 0;
    cancelViewAnim();
    const point = graphPoint(event);
    const node = pickNode(point.x, point.y);
    event.currentTarget.setPointerCapture(event.pointerId);
    fitRef.current = false;
    if (node) {
      dragRef.current = { id: node.id, moved: false, startX: event.clientX, startY: event.clientY };
      node.fixed = true;
    } else {
      // Arrastar o fundo e uma escolha do usuario: o resize nao deve refazer o
      // enquadramento por cima dela.
      manualViewRef.current = true;
      panRef.current = { x: event.clientX, y: event.clientY };
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current) {
      const node = simRef.current?.nodes.find((item) => item.id === dragRef.current?.id);
      if (node) {
        const point = graphPoint(event);
        node.x = point.x;
        node.y = point.y;
        node.vx = 0;
        node.vy = 0;
        if (Math.hypot(event.clientX - dragRef.current.startX, event.clientY - dragRef.current.startY) > 4) {
          dragRef.current.moved = true;
          ignoreClickRef.current = true;
          manualViewRef.current = true;
        }
        draw();
        // Ao arrastar o centro, as ligadas acompanham devagar. Isso e o unico
        // momento em que a fisica roda fora do assentamento inicial, e mesmo
        // assim a 30 Hz.
        const sim = simRef.current;
        if (sim && node.id === data?.center.id) {
          const now = performance.now();
          if (now - lastDragStepRef.current >= 33) {
            lastDragStepRef.current = now;
            simStep(sim);
            draw();
          }
        }
      }
      return;
    }
    if (panRef.current) {
      const view = viewRef.current;
      const dx = event.clientX - panRef.current.x;
      const dy = event.clientY - panRef.current.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) ignoreClickRef.current = true;
      view.panX += dx;
      view.panY += dy;
      panRef.current = { x: event.clientX, y: event.clientY };
      draw();
      return;
    }
    const point = graphPoint(event);
    const node = pickNode(point.x, point.y);
    setHovered(node?.id ?? null);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const drag = dragRef.current;
    dragRef.current = null;
    panRef.current = null;
    if (drag) {
      const sim = simRef.current;
      const node = sim?.nodes.find((item) => item.id === drag.id);
      if (node) {
        const isCenter = drag.id === data?.center.id;
        node.fixed = isCenter;
        if (!drag.moved) {
          selectNode(drag.id);
        } else {
          if (isCenter) {
            // A bola foi solta longe do meio do mundo; a camera desliza ate
            // ela em vez de saltar, entao o centro chega devagar enquanto as
            // ligadas assentam.
            fitRef.current = false;
            manualViewRef.current = true;
            const view = viewRef.current;
            animateView(-node.x * view.zoom, -node.y * view.zoom, 650);
          }
          startSimulation(70);
          return;
        }
      }
    }
  };

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (ignoreClickRef.current) {
      ignoreClickRef.current = false;
      return;
    }
    if (dragRef.current) return;
    const point = graphPoint(event as unknown as React.PointerEvent<HTMLCanvasElement>);
    const node = pickNode(point.x, point.y);
    if (node) selectNode(node.id);
  };

  const handleDoubleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const point = graphPoint(event as unknown as React.PointerEvent<HTMLCanvasElement>);
    const node = pickNode(point.x, point.y);
    if (!node) return;
    if (node.kind === "note") {
      onOpen(node.id.replace(/^note:/, ""));
    } else if (node.kind !== "user") {
      setFocusId(node.id);
    }
  };

  const zoomBy = (factor: number) => {
    cancelViewAnim();
    fitRef.current = false;
    manualViewRef.current = true;
    viewRef.current.zoom = Math.max(0.35, Math.min(3.5, viewRef.current.zoom * factor));
    draw();
  };

  const saveIcon = async (icon: string): Promise<boolean> => {
    if (!entityNode || iconBusy) return false;
    const id = entityNode.id;
    setIconBusy(true);
    setIconError("");
    try {
      await api.setEntityIcon(entityNode.kind, entityNode.label, icon);
      setIconOverrides((current) => ({ ...current, [id]: icon }));
      const node = simRef.current?.nodes.find((item) => item.id === id);
      if (node) {
        node.icon = icon;
        draw();
      }
      return true;
    } catch (err) {
      setIconError(err instanceof Error ? err.message : "não foi possível salvar o ícone");
      return false;
    } finally {
      setIconBusy(false);
    }
  };

  const chooseIcon = async (icon: string) => {
    if (await saveIcon(icon)) setIconOpen(false);
  };

  const openRename = () => {
    if (!entityNode) return;
    setRenameValue(entityNode.label);
    setRenameOpen(true);
    setRenameError("");
    setClaimSelf(false);
    setMergeTarget("");
    setIconOpen(false);
  };

  const closeRename = () => {
    setRenameOpen(false);
    setRenameError("");
  };

  const saveRename = async () => {
    if (!entityNode) return;
    const next = renameValue.trim();
    const claimingSelf = entityNode.kind === "person" && claimSelf;
    const merging = mergeTarget !== "";
    if (!claimingSelf && !merging && (!next || next === entityNode.label)) {
      setRenameOpen(false);
      return;
    }
    setRenameBusy(true);
    setRenameError("");
    try {
      if (claimingSelf) {
        await api.claimSelf(entityNode.label);
      } else if (merging) {
        await api.renameEntity(entityNode.kind, entityNode.label, mergeTarget);
      } else {
        await api.renameEntity(entityNode.kind, entityNode.label, next);
      }
      setRenameOpen(false);
      setFocusId(null);
      setSelectedId(null);
      setGraphVersion((value) => value + 1);
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : "não foi possível renomear");
    } finally {
      setRenameBusy(false);
    }
  };

  const resetAll = () => {
    setFocusId(null);
    setSelectedId(null);
    setNotebookId("");
    setPeriod("all");
    setQuery("");
    setVisible({ person: true, place: true, theme: true, decision: true, note: true, user: true });
    fitRef.current = true;
    manualViewRef.current = false;
    fitView();
  };

  const focusNode = focusId ? data?.nodes.find((node) => node.id === focusId) : null;

  return (
    <section className="map-view">
      <header className="map-head">
        <div className="map-title">
          <h1>Mapa</h1>
          <span
            className="map-stats"
            aria-live="polite"
            title={data?.truncated ? "As arestas mais fortes por nó; o restante fica no detalhe." : undefined}
          >
            {data ? `${data.nodes.length} nós · ${data.edges.length} relações` : ""}
            {data?.truncated ? " · parcial" : ""}
          </span>
          {focusNode && (
            <span className="map-breadcrumb">
              <button type="button" className="link-button" onClick={() => setFocusId(null)}>
                Mapa
              </button>
              <span aria-hidden="true">/</span>
              <strong>{focusNode.label}</strong>
            </span>
          )}
        </div>
        <div className="map-actions">
          <button type="button" className="button button--ghost button--small" onClick={resetAll}>
            Limpar
          </button>
        </div>
      </header>

      <div className="map-toolbar">
        <div className="map-kinds" role="group" aria-label="Tipos no mapa">
          {KINDS.filter((kind) => kind.id !== "note" || hasNotes).map((kind) => (
            <button
              key={kind.id}
              type="button"
              className={visible[kind.id] ? "map-chip map-chip--on" : "map-chip"}
              aria-pressed={visible[kind.id]}
              onClick={() => setVisible((current) => ({ ...current, [kind.id]: !current[kind.id] }))}
            >
              <span className={`map-dot map-dot--${kind.id}`} aria-hidden="true" />
              {kind.label}
              <span className="map-chip-count">{counts[kind.id] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="map-filters">
          <select
            className="map-select"
            aria-label="Caderno do mapa"
            value={notebookId}
            onChange={(event) => setNotebookId(event.target.value)}
          >
            <option value="">Todos os cadernos</option>
            {notebooks.map((notebook) => (
              <option key={notebook.id} value={notebook.id}>
                {notebook.name}
              </option>
            ))}
          </select>
          <select
            className="map-select"
            aria-label="Período do mapa"
            value={period}
            onChange={(event) => setPeriod(event.target.value as Period)}
          >
            {PERIODS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <label className="map-search">
            <SearchIcon size={15} />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar"
              aria-label="Buscar no mapa"
            />
          </label>
        </div>
      </div>

      <div className="map-body">
        <div className="map-canvas-wrap" ref={wrapRef}>
          <div className="map-layers">
            <canvas
              ref={canvasRef}
              className="map-canvas"
              aria-label="Mapa de relações das notas"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onClick={handleClick}
              onPointerLeave={() => setHovered(null)}
              onDoubleClick={handleDoubleClick}
            />
            <canvas className="map-hover-canvas" ref={hoverCanvasRef} aria-hidden="true" />
            <canvas className="map-ripple-canvas" ref={rippleCanvasRef} aria-hidden="true" />
          </div>
          {loading && (
            <div className="map-overlay">
              <Spinner />
            </div>
          )}
          {!loading && error && <div className="map-overlay map-overlay--error">{error}</div>}
          {!loading && !error && data && data.nodes.length === 0 && (
            <div className="map-overlay map-overlay--empty">
              <strong>0</strong>
              <span>relações ainda</span>
            </div>
          )}
          <div className="map-zoom" aria-label="Zoom">
            <button type="button" className="icon-button" onClick={() => zoomBy(1.25)} aria-label="Aproximar">
              +
            </button>
            <button type="button" className="icon-button" onClick={() => zoomBy(0.8)} aria-label="Afastar">
              −
            </button>
            <button type="button" className="icon-button" onClick={fitView} aria-label="Ajustar à tela">
              <FitIcon size={9} />
            </button>
          </div>
        </div>

        {selection ? (
          <aside className="map-detail" aria-label="Detalhe do mapa">
            <header className="map-detail-head">
              <span className={`map-kind map-kind--${selection.kind}`}>{kindLabel(selection.kind)}</span>
              <button
                type="button"
                className="icon-button"
                onClick={() => setSelectedId(null)}
                aria-label="Fechar detalhe"
              >
                ×
              </button>
            </header>
            <div className="map-detail-title">
              {entityNode && (
                <div className="map-icon-anchor" ref={iconBoxRef}>
                  <button
                    type="button"
                    className="map-icon-button"
                    aria-label="Ícone da bola"
                    title="Ícone"
                    aria-haspopup="dialog"
                    aria-expanded={iconOpen}
                    onClick={() => {
                      setIconError("");
                      setIconOpen((value) => !value);
                    }}
                  >
                    <IconPreview icon={iconKeyFor(entityNode.kind, entityIcon)} size={16} />
                  </button>
                  {iconOpen && (
                    <div className="map-icon-popover" role="dialog" aria-label="Escolher ícone">
                      <div className="map-icon-grid" role="group">
                        <button
                          type="button"
                          className={
                            entityIcon
                              ? "map-icon-choice"
                              : "map-icon-choice map-icon-choice--on"
                          }
                          onClick={() => void chooseIcon("")}
                          aria-pressed={!entityIcon}
                          aria-label="Ícone do tipo"
                          title="Ícone do tipo"
                          disabled={iconBusy}
                        >
                          <IconPreview icon={iconKeyFor(entityNode.kind, "")} />
                        </button>
                        {GRAPH_ICONS.map((item) => (
                          <button
                            key={item.key}
                            type="button"
                            className={
                              entityIcon === item.key
                                ? "map-icon-choice map-icon-choice--on"
                                : "map-icon-choice"
                            }
                            onClick={() => void chooseIcon(item.key)}
                            aria-pressed={entityIcon === item.key}
                            aria-label={item.label}
                            title={item.label}
                            disabled={iconBusy}
                          >
                            <IconPreview icon={item.key} />
                          </button>
                        ))}
                      </div>
                      {iconError && <p className="error">{iconError}</p>}
                    </div>
                  )}
                </div>
              )}
              {renameOpen && entityNode ? (
                <input
                  autoFocus
                  className="map-title-input"
                  value={claimSelf ? settings?.owner_name?.trim() || "Você" : renameValue}
                  maxLength={200}
                  aria-label="Nome da bola"
                  disabled={claimSelf || mergeTarget !== ""}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      closeRename();
                    } else if (event.key === "Enter") {
                      event.preventDefault();
                      void saveRename();
                    }
                  }}
                />
              ) : (
                <h2>{selection.label || "Sem título"}</h2>
              )}
              {entityNode && !renameOpen && (
                <button
                  type="button"
                  className="icon-button map-detail-rename"
                  aria-label="Renomear"
                  title="Renomear"
                  onClick={openRename}
                >
                  <PencilIcon size={12} />
                </button>
              )}
            </div>
            {renameOpen && entityNode && (
              <div className="map-inline-edit">
                {entityNode.kind === "person" && (
                  <label className="map-rename-option">
                    <input
                      type="checkbox"
                      checked={claimSelf}
                      onChange={(event) => {
                        setClaimSelf(event.target.checked);
                        if (event.target.checked) setMergeTarget("");
                      }}
                    />
                    Sou eu
                  </label>
                )}
                {mergeOptions.length > 0 && (
                  <label
                    className="map-rename-option"
                    title="O nome antigo vira alias e nunca mais precisa ser mesclado."
                  >
                    Mesclar em
                    <select
                      className="map-rename-select"
                      value={mergeTarget}
                      onChange={(event) => {
                        setMergeTarget(event.target.value);
                        if (event.target.value) setClaimSelf(false);
                      }}
                      aria-label={`Mesclar com outro ${kindLabel(entityNode.kind).toLowerCase()}`}
                    >
                      <option value="">—</option>
                      {mergeOptions.map((item) => (
                        <option key={item.id ?? item.name} value={item.name}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="map-inline-actions">
                  <button
                    type="button"
                    className="button button--primary button--small"
                    onClick={() => void saveRename()}
                    disabled={renameBusy}
                  >
                    Salvar
                  </button>
                  <button
                    type="button"
                    className="button button--ghost button--small"
                    onClick={closeRename}
                  >
                    Cancelar
                  </button>
                </div>
                {renameError && <p className="error">{renameError}</p>}
              </div>
            )}
            {selection.kind === "note" && noteNode && (
              <>
                <dl className="map-numbers">
                  <div>
                    <dt>Data</dt>
                    <dd>{formatDate(noteNode.date)}</dd>
                  </div>
                  <div>
                    <dt>Autor</dt>
                    <dd>
                      {authorLabel(
                        noteNode.author,
                        settings?.owner_name ?? "",
                        settings?.all_notes_mine ?? true,
                      )}
                    </dd>
                  </div>
                </dl>
                <button
                  type="button"
                  className="button button--primary button--small"
                  onClick={() => onOpen(noteNode.id.replace(/^note:/, ""))}
                >
                  Abrir nota
                </button>
              </>
            )}
            {selection.kind === "user" && (
              <dl className="map-numbers">
                <div>
                  <dt>Nós</dt>
                  <dd>{data?.nodes.length ?? 0}</dd>
                </div>
                <div>
                  <dt>Relações</dt>
                  <dd>{data?.edges.length ?? 0}</dd>
                </div>
                <div>
                  <dt>Pessoas</dt>
                  <dd>{counts.person ?? 0}</dd>
                </div>
                <div>
                  <dt>Lugares</dt>
                  <dd>{counts.place ?? 0}</dd>
                </div>
                <div>
                  <dt>Temas</dt>
                  <dd>{counts.theme ?? 0}</dd>
                </div>
              </dl>
            )}
            {entityNode && (
              <>
                <dl className="map-numbers">
                  <div>
                    <dt>Menções</dt>
                    <dd>{entityNode.mentions}</dd>
                  </div>
                  <div>
                    <dt>Notas</dt>
                    <dd>{entityNode.notes}</dd>
                  </div>
                  {entityNode.kind === "person" && (
                    <div>
                      <dt>Tom</dt>
                      <dd>{Number(entityNode.sentiment ?? 0).toFixed(2)}</dd>
                    </div>
                  )}
                </dl>
                <p className="map-seen">Visto em {formatDate(entityNode.last_seen)}</p>
                <div className="map-detail-actions">
                  {focusId !== entityNode.id && (
                    <button
                      type="button"
                      className="button button--primary button--small"
                      onClick={() => setFocusId(entityNode.id)}
                    >
                      Expandir
                    </button>
                  )}
                  {focusId && (
                    <button
                      type="button"
                      className="button button--ghost button--small"
                      onClick={() => {
                        setFocusId(null);
                        setSelectedId(null);
                      }}
                    >
                      Voltar
                    </button>
                  )}
                </div>
                {detailLoading && (
                  <p className="muted">
                    <Spinner />
                  </p>
                )}
                {detailError && <p className="error">{detailError}</p>}
                {mentionsLoading && (
                  <p className="muted">
                    <Spinner />
                  </p>
                )}
                {mentionsError && <p className="error">{mentionsError}</p>}
                {mentionGroups.length > 0 && (
                  <>
                    <h3 className="map-subhead">Trechos</h3>
                    <ul className="map-mentions stagger-in">
                      {mentionGroups.map((group) => (
                        <li key={group.entryId} className="map-mention-group">
                          <button
                            type="button"
                            className="map-mention-entry"
                            onClick={() => onOpen(group.entryId)}
                          >
                            <span className="map-mention-title">{group.title || "Entrada"}</span>
                            <span className="map-mention-date">{formatDate(group.date)}</span>
                          </button>
                          {group.comment && (
                            <p className="map-mention-comment">
                              <span className="map-mention-comment-label">Análise</span>
                              {group.comment}
                            </p>
                          )}
                          <ul className="map-excerpts stagger-in">
                            {group.items.map((mention, index) => (
                              <li key={`${mention.source}:${mention.start_ms ?? "texto"}:${index}`}>
                                <button
                                  type="button"
                                  className="map-excerpt"
                                  onClick={() => onOpen(mention.entry_id)}
                                >
                                  {mention.source === "transcript" ? (
                                    <span className="map-moment-time">
                                      {formatMs(mention.start_ms ?? 0)}
                                    </span>
                                  ) : (
                                    <span className="map-excerpt-source">texto</span>
                                  )}
                                  <span className="map-excerpt-text">
                                    {highlightTerm(mention.text, mention.term)}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {!mentionsLoading && otherEntries.length > 0 && (
                  <>
                    <h3 className="map-subhead">Notas</h3>
                    <ul className="map-note-list stagger-in">
                      {otherEntries.slice(0, 12).map((entry) => (
                        <li key={entry.id}>
                          <button type="button" className="map-note" onClick={() => onOpen(entry.id)}>
                            <span className="map-note-title">{entry.title || "Entrada"}</span>
                            <span className="map-note-meta">
                              {formatDate(entry.date)} · {entry.count}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </aside>
        ) : (
          <aside className="map-insights" aria-label="Insights do mapa">
            <header className="map-insights-head">
              <h2>
                <InsightsIcon size={15} />
                Insights
              </h2>
              <span className="map-insights-total" title="Entidades no mapa">
                {(counts.person ?? 0) +
                  (counts.place ?? 0) +
                  (counts.theme ?? 0) +
                  (counts.decision ?? 0)}
              </span>
            </header>
            <div className="map-insights-tabs" role="tablist" aria-label="Tipo de insight">
              {INSIGHT_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={insightTab === tab.id}
                  className={
                    insightTab === tab.id
                      ? "map-insights-tab map-insights-tab--on"
                      : "map-insights-tab"
                  }
                  onClick={() => setInsightTab(tab.id)}
                >
                  {tab.label}
                  {tab.id !== "mood" && (
                    <span className="map-insights-tab-count">{counts[tab.id] ?? 0}</span>
                  )}
                </button>
              ))}
            </div>
            {insightTab === "mood" ? (
              <MoodView refreshKey={refreshKey} />
            ) : loading && !data ? (
              <p className="muted">
                <Spinner />
              </p>
            ) : insightEntities.length === 0 ? (
              <p className="map-insights-empty">
                0 {INSIGHT_TABS.find((tab) => tab.id === insightTab)?.label.toLocaleLowerCase()}
              </p>
            ) : (
              <ul className="map-insights-list stagger-in">
                {insightEntities.map((entity) => (
                  <li key={entity.id}>
                    <button
                      type="button"
                      className="map-insight"
                      onClick={() => selectEntity(entity)}
                    >
                      <span className="map-insight-name">{entity.label}</span>
                      <span className="map-insight-meta">
                        {entity.mentions} {entity.mentions === 1 ? "menção" : "menções"} ·{" "}
                        {entity.notes} {entity.notes === 1 ? "nota" : "notas"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}

export default MapView;
