import type { Analysis, EntityKind } from "../types";

/**
 * Relacoes de uma nota: a nota no centro e as entidades que a analise encontrou
 * em volta, com a espessura da ligacao mostrando o peso (mencoes da pessoa/lugar
 * ou confianca do tema).
 *
 * O desenho e deterministico: a mesma analise sempre gera o mesmo mapa, entao
 * ele nao "pula" ao reabrir a nota. Os nomes sao os rotulos; a contagem fica no
 * tooltip.
 */

type RelationKind = Extract<EntityKind, "person" | "place" | "theme">;

export interface NoteRelationsProps {
  analysis: Analysis;
  onOpenEntity: (kind: EntityKind, name: string) => void;
}

interface RelationNode {
  kind: RelationKind;
  name: string;
  /** Peso 0..1 dentro do tipo, usado no raio do no e na espessura da aresta. */
  weight: number;
  /** Numero mostrado no tooltip (mencoes, para pessoa/lugar). */
  count?: number;
}

const MAX_NODES = 10;
const WIDTH = 300;
const HEIGHT = 240;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;
// Cada raio tem comprimento proprio, como os pulsos de um simbolo de marca:
// a distancia do no ao centro varia de um para o outro, entao o desenho nao
// fica um circulo certinho. A largura fica apertada de proposito — o rotulo e
// o que ocupa a largura do painel; nome comprido e cortado com reticencias (o
// chip abaixo mostra inteiro, e o tooltip tambem).
const RADIUS_X = [44, 54, 40, 52, 46, 54, 42, 50, 48, 52];
const RADIUS_Y = [92, 58, 82, 50, 88, 60, 76, 54, 84, 62];
const MAX_LABEL = 16;

const KIND_LABEL: Record<RelationKind, string> = {
  person: "Pessoa",
  place: "Lugar",
  theme: "Tema",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function weightOf(values: number[]): (value: number) => number {
  const top = Math.max(...values, 0);
  if (top <= 0) return () => 0.5;
  return (value) => clamp(value / top, 0, 1);
}

/** Junta as entidades da analise numa lista estavel, com o peso por tipo. */
function relations(analysis: Analysis): { nodes: RelationNode[]; hidden: number } {
  const people = analysis.people_detail ?? [];
  const places = analysis.places_detail ?? [];
  const themes = analysis.themes ?? [];

  const peopleWeight = weightOf(people.map((item) => item.count));
  const placesWeight = weightOf(places.map((item) => item.count));
  const themesWeight = weightOf(themes.map((item) => item.confidence));

  const all: RelationNode[] = [
    ...people.flatMap((item) =>
      item.name.trim()
        ? [{ kind: "person" as const, name: item.name.trim(), weight: peopleWeight(item.count), count: item.count }]
        : [],
    ),
    ...places.flatMap((item) =>
      item.name.trim()
        ? [{ kind: "place" as const, name: item.name.trim(), weight: placesWeight(item.count), count: item.count }]
        : [],
    ),
    ...themes.flatMap((item) =>
      item.name.trim()
        ? [{ kind: "theme" as const, name: item.name.trim(), weight: themesWeight(item.confidence) }]
        : [],
    ),
  ];

  // Mais fortes primeiro para o corte, depois por tipo/nome para o desenho.
  const kept = [...all].sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name)).slice(0, MAX_NODES);
  const order: Record<RelationKind, number> = { person: 0, place: 1, theme: 2 };
  kept.sort(
    (a, b) => order[a.kind] - order[b.kind] || b.weight - a.weight || a.name.localeCompare(b.name),
  );
  return { nodes: kept, hidden: all.length - kept.length };
}

function shortLabel(name: string): string {
  return name.length > MAX_LABEL ? `${name.slice(0, MAX_LABEL - 1)}…` : name;
}

function tooltip(node: RelationNode): string {
  if (node.kind !== "theme" && typeof node.count === "number") {
    return `${node.name} · ${node.count} ${node.count === 1 ? "menção" : "menções"}`;
  }
  return node.name;
}

export function NoteRelations({ analysis, onOpenEntity }: NoteRelationsProps) {
  const { nodes, hidden } = relations(analysis);
  if (nodes.length === 0) return null;

  return (
    <svg
      className="note-relations"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="group"
      aria-label="Relações desta nota"
    >
      {nodes.map((node, index) => {
        const angle = -Math.PI / 2 + (2 * Math.PI * index) / nodes.length;
        const x = CENTER_X + RADIUS_X[index % RADIUS_X.length] * Math.cos(angle);
        const y = CENTER_Y + RADIUS_Y[index % RADIUS_Y.length] * Math.sin(angle);
        return (
          <line
            key={`edge-${node.kind}-${node.name}`}
            className="note-relations-edge"
            x1={CENTER_X}
            y1={CENTER_Y}
            x2={x}
            y2={y}
            strokeWidth={1 + 1.4 * node.weight}
          />
        );
      })}

      {/* A nota: o centro do desenho, sem texto (o painel ja diz qual e). */}
      <g className="note-relations-self">
        <title>Esta nota</title>
        <circle className="note-relations-self-halo" cx={CENTER_X} cy={CENTER_Y} r={22} />
        <rect
          className="note-relations-self-dot"
          x={CENTER_X - 10}
          y={CENTER_Y - 13}
          width={20}
          height={26}
          rx={3}
        />
        <path
          className="note-relations-self-fold"
          d={`M ${CENTER_X + 3} ${CENTER_Y - 13} L ${CENTER_X + 10} ${CENTER_Y - 6} L ${CENTER_X + 3} ${CENTER_Y - 6} Z`}
        />
      </g>

      {nodes.map((node, index) => {
        const angle = -Math.PI / 2 + (2 * Math.PI * index) / nodes.length;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const x = CENTER_X + RADIUS_X[index % RADIUS_X.length] * cos;
        const y = CENTER_Y + RADIUS_Y[index % RADIUS_Y.length] * sin;
        const radius = 6 + 3.5 * node.weight;
        const right = cos > 0.25;
        const left = cos < -0.25;
        const anchor = right ? "start" : left ? "end" : "middle";
        const labelX = right ? x + radius + 4 : left ? x - radius - 4 : x;
        const labelY = right || left ? y + 3.5 : sin > 0 ? y + radius + 12 : y - radius - 6;
        return (
          <g
            key={`${node.kind}-${node.name}`}
            className={`note-relations-node note-relations-node--${node.kind}`}
            role="button"
            tabIndex={0}
            aria-label={`${KIND_LABEL[node.kind]}: ${node.name}`}
            onClick={() => onOpenEntity(node.kind, node.name)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onOpenEntity(node.kind, node.name);
            }}
          >
            <title>{tooltip(node)}</title>
            <circle className="note-relations-dot" cx={x} cy={y} r={radius} />
            <text
              className="note-relations-label"
              x={labelX}
              y={labelY}
              textAnchor={anchor}
            >
              {shortLabel(node.name)}
            </text>
          </g>
        );
      })}

      {hidden > 0 && (
        <text className="note-relations-more" x={WIDTH - 4} y={HEIGHT - 4} textAnchor="end">
          +{hidden}
          <title>{`${hidden} relações fora do desenho`}</title>
        </text>
      )}
    </svg>
  );
}
