import type { Entry } from "../types";

/** Ordem da lista de notas: da mais recente para a mais antiga, ou o inverso. */
export type NoteOrder = "newest" | "oldest";

/**
 * Data da nota: a do evento (`recorded_at`), com `created_at` de reserva.
 *
 * Nota importada do Notion ou audio gravado antes guarda em `recorded_at` a data
 * original; `created_at` e so a data em que a nota nasceu. A lista e o
 * calendario mostram e ordenam por esta data.
 */
export function noteDate(entry: Entry): string {
  return entry.recorded_at ?? entry.created_at;
}

/** Milissegundos da data da nota; data ilegivel vai para o fim da lista. */
function noteTime(entry: Entry): number {
  const time = new Date(noteDate(entry)).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/**
 * Ordena pela data da nota, nunca por `updated_at`: editar uma nota antiga nao
 * pode empurra-la para o topo. Compara instantes, nao texto: datas com fusos ou
 * precisao diferentes ("...T01:00:00Z" e "...T23:00:00-03:00") ordenam certo.
 */
export function sortNotesByDate(entries: Entry[], order: NoteOrder): Entry[] {
  const direction = order === "oldest" ? 1 : -1;
  return [...entries].sort((a, b) => {
    const byDate = noteTime(a) - noteTime(b);
    if (byDate !== 0) return byDate * direction;
    // Desempate estavel: notas com a mesma data nao trocam de lugar entre renders.
    return a.id.localeCompare(b.id) * direction;
  });
}
