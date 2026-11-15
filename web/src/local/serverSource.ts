/**
 * Cliente HTTP para importar de um servidor.
 *
 * Fala com a API que ja existe (`/api/v1`), sem endpoint novo: manifesto,
 * detalhe da nota, corpo em markdown e a lista de apagadas.
 */

import type { Entry, Note } from "../types";

import type { ImportSource } from "./import";

export function serverSource(baseUrl: string, token: string): ImportSource {
  const base = baseUrl.trim().replace(/\/+$/, "");

  const get = async <T>(path: string): Promise<T> => {
    const res = await fetch(`${base}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText || "falha"} em ${path}`);
    }
    return (await res.json()) as T;
  };

  return {
    manifest: async (cursor) => {
      const query = new URLSearchParams({ kind: "entries", limit: "500" });
      if (cursor) query.set("cursor", cursor);
      // O manifesto chama a lista de `items` e o cursor de `next_cursor`.
      const resposta = await get<{ items?: { id: string }[]; next_cursor?: string }>(
        `/api/v1/sync/manifest?${query.toString()}`,
      );
      return { entries: resposta.items ?? [], next: resposta.next_cursor || undefined };
    },
    entry: (id) => get<Entry>(`/api/v1/entries/${encodeURIComponent(id)}`),
    body: async (id) => {
      const resposta = await get<{ notes?: Note[] }>(
        `/api/v1/entries/${encodeURIComponent(id)}/notes`,
      );
      const nota = resposta.notes?.[0];
      return nota?.content_markdown ?? "";
    },
    deleted: async () => {
      const resposta = await get<{ entries?: Entry[] }>("/api/v1/entries?deleted=1&limit=500");
      return resposta.entries ?? [];
    },
  };
}
