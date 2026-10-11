/**
 * Titulo da nota: data e hora do inicio da gravacao, no fuso local.
 * Formato: "dd/MM/yyyy HH:mm" (pt-BR).
 */

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatTitle(date: Date): string {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** Inicio da gravacao em ISO 8601 UTC, como o servidor espera. */
export function toRecordedAt(date: Date): string {
  return date.toISOString();
}
