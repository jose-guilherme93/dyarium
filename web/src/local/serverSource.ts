/**
 * Cliente HTTP para importar de um servidor.
 *
 * Fala com a API que ja existe (`/api/v1`), sem endpoint novo: manifesto,
 * detalhe da nota, corpo em markdown e a lista de apagadas.
 */

import type { Analysis, Entry, Note, Notebook } from "../types";

import type { ImportSource } from "./import";

/** Prazo de cada requisicao; sem ele um servidor mudo prende a importacao. */
const PRAZO_MS = 30_000;

/** O que sobe para a faixa quando o outro lado para de responder. */
const PRAZO_ERRO = "servidor nao respondeu em 30s";

/**
 * Roda a requisicao inteira (inclusive a leitura do corpo) sob prazo.
 *
 * O `abort` fecha o socket num navegador de verdade; a corrida garante que um
 * `fetch` que ignore o sinal ainda termine no prazo — sem isso uma resposta que
 * nunca chega prenderia os seis trabalhadores da importacao para sempre.
 */
async function comPrazo<T>(operacao: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controle = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const estouro = new Promise<never>((_, rejeitar) => {
    timer = setTimeout(() => {
      controle.abort();
      rejeitar(new Error(PRAZO_ERRO));
    }, PRAZO_MS);
  });
  try {
    return await Promise.race([operacao(controle.signal), estouro]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function serverSource(baseUrl: string, token: string): ImportSource {
  const base = baseUrl.trim().replace(/\/+$/, "");

  const get = <T>(path: string): Promise<T> =>
    comPrazo(async (signal) => {
      const res = await fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal,
      });
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText || "falha"} em ${path}`);
      }
      return (await res.json()) as T;
    });

  /**
   * Como `get`, mas 404 vira null: nota sem transcricao ou sem analise nao e
   * erro, so nao tem o que trazer. Os outros status continuam propagando.
   */
  const getOrNull = <T>(path: string): Promise<T | null> =>
    comPrazo(async (signal) => {
      const res = await fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal,
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText || "falha"} em ${path}`);
      }
      return (await res.json()) as T;
    });

  return {
    notebooks: async () => {
      // Servidor antigo, sem a rota: 404 e "nao tem caderno", nao erro.
      const resposta = await getOrNull<{ notebooks?: Notebook[] }>("/api/v1/notebooks");
      return resposta?.notebooks ?? [];
    },
    manifest: async (cursor) => {
      const query = new URLSearchParams({ kind: "entries", limit: "500" });
      if (cursor) query.set("cursor", cursor);
      // O manifesto chama a lista de `items` e o cursor de `next_cursor`.
      const resposta = await get<{ items?: { id: string }[]; next_cursor?: string }>(
        `/api/v1/sync/manifest?${query.toString()}`,
      );
      return { entries: resposta.items ?? [], next: resposta.next_cursor || undefined };
    },
    cover: async (id) => {
      const path = `/api/v1/notebooks/${encodeURIComponent(id)}/cover`;
      return comPrazo(async (signal) => {
        const res = await fetch(`${base}${path}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal,
        });
        // Caderno sem capa responde 404: nao e erro, so nao tem o que baixar.
        if (res.status === 404) return null;
        if (!res.ok) {
          throw new Error(`${res.status} ${res.statusText || "falha"} em ${path}`);
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        return {
          bytes,
          contentType: res.headers.get("content-type") || "application/octet-stream",
        };
      });
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
    audio: async (id) => {
      const path = `/api/v1/entries/${encodeURIComponent(id)}/audio`;
      return comPrazo(async (signal) => {
        const res = await fetch(`${base}${path}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal,
        });
        // Nota sem audio responde 404: nao e erro, so nao tem o que baixar.
        if (res.status === 404) return null;
        if (!res.ok) {
          throw new Error(`${res.status} ${res.statusText || "falha"} em ${path}`);
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        return { bytes, contentType: res.headers.get("content-type") || "audio/mp4" };
      });
    },
    transcript: async (id) => {
      const resposta = await getOrNull<{
        text?: string;
        segments?: {
          start_ms?: number;
          end_ms?: number;
          text?: string;
          edited?: boolean;
          revised?: string;
          reviewed?: boolean;
        }[];
      }>(`/api/v1/entries/${encodeURIComponent(id)}/transcript`);
      if (!resposta) return null;
      return {
        text: resposta.text ?? "",
        // O servidor manda `idx` e nulos possiveis; o cofre so guarda o que a
        // leitura desenha (tempos, texto e as marcas da revisao).
        segments: (resposta.segments ?? []).map((segment) => ({
          start_ms: segment.start_ms ?? 0,
          end_ms: segment.end_ms ?? segment.start_ms ?? 0,
          text: segment.text ?? "",
          ...(segment.edited ? { edited: true } : {}),
          ...(segment.revised ? { revised: segment.revised } : {}),
          ...(segment.reviewed ? { reviewed: true } : {}),
        })),
      };
    },
    analysis: (id) => getOrNull<Analysis>(`/api/v1/entries/${encodeURIComponent(id)}/analysis`),
  };
}
