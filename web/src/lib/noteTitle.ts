import type { Entry } from "../types";

/**
 * Titulo que a lista e a aba mostram. O titulo automatico antigo carregava a
 * data no fim; ela aparece separada, pequena, e aqui sai fora. Sem titulo, a
 * previa ocupa o lugar; sem previa, o nome do arquivo ou uma palavra curta.
 */
export function noteTitle(entry: Entry): string {
  const rawTitle = (entry.title || "").trim();
  const isAutomatic =
    rawTitle.toLowerCase() === "texto" ||
    rawTitle.toLowerCase() === "audio" ||
    rawTitle.toLowerCase() === "áudio";
  if (rawTitle && !isAutomatic) {
    return rawTitle.replace(/\s·\s\d{2}\/\d{2}\/\d{4}\s\d{2}:\d{2}$/, "");
  }
  const preview = (entry.preview || "").trim();
  if (preview) {
    return preview.split("\n")[0].trim();
  }
  if (entry.original_filename) {
    return entry.original_filename;
  }
  if (entry.source !== "text") {
    return "Áudio";
  }
  return "Sem título";
}
