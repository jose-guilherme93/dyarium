// Small formatting helpers shared by the notes UI.

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "--:--";
  }
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function formatDate(value?: string | null): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(value?: string | null): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Data curta da linha de nota ("19 out" ou "19 out 2019"). O ano so aparece
 * quando a nota nao e deste ano; o espaco da lista e curto demais para repetir
 * o ano em todas as linhas.
 */
export function formatShortDate(value?: string | null): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const label = date
    .toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
    .replace(" de ", " ")
    .replace(".", "");
  return date.getFullYear() === new Date().getFullYear()
    ? label
    : `${label} ${date.getFullYear()}`;
}

// dayLabel groups notes in the list ("Hoje", "Ontem" or a date).
export function dayLabel(value?: string | null): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((start.getTime() - target.getTime()) / 86400000);
  if (diff === 0) {
    return "Hoje";
  }
  if (diff === 1) {
    return "Ontem";
  }
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

export function dayKey(value?: string | null): string {
  if (!value) {
    return "sem-data";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "sem-data";
  }
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Tamanho legivel para o painel da nota ("95 KB"), sem "0.09 MB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 bytes";
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} bytes`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${Math.round(kb)} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0).replace(".", ",")} MB`;
}
