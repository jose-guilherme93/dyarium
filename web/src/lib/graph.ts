import type { AuthorRole, GraphEdge, GraphNode, GraphResponse } from "../types";

/** Raio de um no de entidade: relativo ao maior da visao, com teto fixo. */
export function relativeRadius(mentions: number, maxMentions: number): number {
  const max = Math.max(1, maxMentions);
  const ratio = Math.max(0, Math.min(1, mentions / max));
  return 6 + 20 * Math.sqrt(ratio);
}

/** Quem gravou a nota, ja resolvido com o padrao do app. */
export function authorLabel(
  author: AuthorRole | undefined,
  ownerName: string,
  allNotesMine: boolean,
): string {
  const role = author || (allNotesMine ? "self" : "");
  const owner = ownerName.trim() || "Você";
  switch (role) {
    case "self":
      return owner;
    case "other":
      return "Outros";
    case "mixed":
      return `${owner} e outros`;
    default:
      return "Sem autor";
  }
}

/** Filtra o grafo pelos tipos visiveis, mantendo o centro. */
export function filterGraph(
  data: GraphResponse,
  kinds: Set<GraphNode["kind"]>,
): { nodes: GraphNode[]; edges: GraphEdge[]; center: GraphNode } {
  const nodes = data.nodes.filter((node) => kinds.has(node.kind));
  const visible = new Set(nodes.map((node) => node.id));
  visible.add(data.center.id);
  const edges = data.edges.filter((edge) => visible.has(edge.source) && visible.has(edge.target));
  return { nodes, edges, center: data.center };
}

/** Contagem por tipo para os chips de filtro. */
export function kindCounts(data: GraphResponse): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const node of data.nodes) {
    counts[node.kind] = (counts[node.kind] ?? 0) + 1;
  }
  return counts;
}

/** Rótulo curto para o detalhe, sem paragrafo. */
export function kindLabel(kind: GraphNode["kind"]): string {
  switch (kind) {
    case "person":
      return "Pessoa";
    case "place":
      return "Lugar";
    case "theme":
      return "Tema";
    case "decision":
      return "Decisão";
    case "note":
      return "Nota";
    default:
      return "Você";
  }
}
