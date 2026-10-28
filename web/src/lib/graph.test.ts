import { describe, expect, it } from "vitest";
import { authorLabel, filterGraph, kindCounts, relativeRadius } from "./graph";
import type { GraphResponse } from "../types";

const data: GraphResponse = {
  center: { id: "user", kind: "user", label: "João", mentions: 0, notes: 0 },
  nodes: [
    { id: "person:1", kind: "person", label: "Maria", mentions: 10, notes: 3 },
    { id: "place:1", kind: "place", label: "Recife", mentions: 2, notes: 1 },
    { id: "note:1", kind: "note", label: "Nota", mentions: 0, notes: 0 },
  ],
  edges: [
    { source: "user", target: "person:1", kind: "relation", weight: 3 },
    { source: "user", target: "place:1", kind: "relation", weight: 1 },
    { source: "note:1", target: "person:1", kind: "mention", weight: 2 },
  ],
  total_nodes: 3,
  total_edges: 3,
  truncated: false,
};

describe("graph helpers", () => {
  it("limita o raio ao maior no da visao", () => {
    expect(relativeRadius(0, 10)).toBe(6);
    expect(relativeRadius(10, 10)).toBe(26);
    expect(relativeRadius(100, 10)).toBe(26);
  });

  it("resolve o autor da nota com o padrao do app", () => {
    expect(authorLabel("self", "João", true)).toBe("João");
    expect(authorLabel("", "João", true)).toBe("João");
    expect(authorLabel("", "João", false)).toBe("Sem autor");
    expect(authorLabel("other", "João", true)).toBe("Outros");
    expect(authorLabel("mixed", "João", true)).toBe("João e outros");
  });

  it("filtra tipos sem deixar aresta orfa", () => {
    const filtered = filterGraph(data, new Set(["person", "note"] as const));
    expect(filtered.nodes.map((node) => node.id)).toEqual(["person:1", "note:1"]);
    expect(filtered.edges.map((edge) => edge.kind)).toEqual(["relation", "mention"]);
    expect(kindCounts(data)).toMatchObject({ person: 1, place: 1, note: 1 });
  });
});
