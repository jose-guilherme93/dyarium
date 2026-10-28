/**
 * Datas do export HTML do Notion.
 *
 * O Notion escreve a data visivel no texto e, quando consegue, o mesmo valor no
 * atributo `datetime` do <time>. O texto depende do idioma da conta
 * ("17 de novembro de 2025 15:57", "March 1, 2024", "12/10/2026") e pode omitir
 * o ano quando a data e do ano da exportacao. O atributo, quando existe, manda:
 * e o unico valor sem ambiguidade.
 *
 * O import nao usa o ano da importacao em nenhum caso. Data sem ano usa o ano
 * da exportacao (ou o ano escolhido na tela de importacao), nunca o ano atual.
 */

export interface NotionDateValue {
  date: Date;
  /** `false` quando o texto nao trazia o ano e ele veio do fallback. */
  hadYear: boolean;
  /** `true` quando o valor traz hora; a data sem hora vira meio-dia local. */
  hasTime: boolean;
  /** Texto original, para o relatorio da importacao. */
  raw: string;
}

interface MonthName {
  month: number;
  order: "day-first" | "month-first" | "both";
}

const MONTHS = new Map<string, MonthName>();

function monthKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function addMonth(names: string[], month: number, order: MonthName["order"]): void {
  for (const name of names) {
    MONTHS.set(monthKey(name), { month, order });
  }
}

addMonth(["janeiro", "jan"], 1, "day-first");
addMonth(["fevereiro", "fev"], 2, "day-first");
addMonth(["marco", "mar"], 3, "day-first");
addMonth(["abril", "abr"], 4, "day-first");
addMonth(["maio", "mai"], 5, "day-first");
addMonth(["junho", "jun"], 6, "day-first");
addMonth(["julho", "jul"], 7, "day-first");
addMonth(["agosto", "ago"], 8, "day-first");
addMonth(["setembro", "set"], 9, "day-first");
addMonth(["outubro", "out"], 10, "day-first");
addMonth(["novembro", "nov"], 11, "day-first");
addMonth(["dezembro", "dez"], 12, "day-first");

addMonth(["january", "jan"], 1, "month-first");
addMonth(["february", "feb"], 2, "month-first");
addMonth(["march", "mar"], 3, "month-first");
addMonth(["april", "apr"], 4, "month-first");
addMonth(["may"], 5, "month-first");
addMonth(["june", "jun"], 6, "month-first");
addMonth(["july", "jul"], 7, "month-first");
addMonth(["august", "aug"], 8, "month-first");
addMonth(["september", "sept", "sep"], 9, "month-first");
addMonth(["october", "oct"], 10, "month-first");
addMonth(["november", "nov"], 11, "month-first");
addMonth(["december", "dec"], 12, "month-first");

// Notion usa "1 de setembro de 2026" em pt-BR e "11 de septiembre de 2026" em
// espanhol; a particula e removida antes da leitura.
const PARTICLES = /\bde\b/gi;
const RANGE = /\s*(?:→|->|–|—)\s*/;
const TIME_ZONE = /\s*\((?:GMT|UTC)(?:[+-]\d{1,2}(?::\d{2})?)?\)\s*$/i;
const ANY_TIME_ZONE = /\s*\([A-Z]{2,5}\)\s*$/;

function clean(value: string): string {
  return value
    .replace(/^\s*@\s*/, "")
    .replace(TIME_ZONE, "")
    .replace(ANY_TIME_ZONE, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Separa "17 de novembro de 2025 15:57" em data e hora. */
function splitTime(value: string): { date: string; hour: number; minute: number; second: number; hasTime: boolean } {
  const match = /(?:^|\s)(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([ap]m))?\s*$/i.exec(value);
  if (!match) {
    return { date: value.trim(), hour: 12, minute: 0, second: 0, hasTime: false };
  }
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);
  const suffix = (match[4] ?? "").toLowerCase();
  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  return {
    date: value.slice(0, match.index).replace(/[, ]+$/, "").trim(),
    hour,
    minute,
    second,
    hasTime: true,
  };
}

function validDate(year: number, month: number, day: number, hour: number, minute: number, second: number): Date | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
  const date = new Date(year, month - 1, day, hour, minute, second);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute ||
    date.getSeconds() !== second
  ) {
    return null;
  }
  return date;
}

function numericDate(date: string, locale: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4})$/.exec(date);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[3]);
  const year = Number(match[4]);
  let dayFirst = locale.toLowerCase().startsWith("pt") || locale.toLowerCase().startsWith("es");
  if (first > 12 && second <= 12) dayFirst = true;
  if (second > 12 && first <= 12) dayFirst = false;
  return dayFirst
    ? { year, month: second, day: first }
    : { year, month: first, day: second };
}

function namedDate(date: string): { year?: number; month: number; day: number } | null {
  // "17 de novembro de 2025": a particula ja foi removida por `clean`.
  const normalized = date.replace(PARTICLES, " ").replace(/\s+/g, " ").trim();
  const dayFirst = /^(\d{1,2})\.?\s+([^\d]+?)(?:\s+(\d{4}))?$/.exec(normalized);
  if (dayFirst) {
    const month = MONTHS.get(monthKey(dayFirst[2]));
    if (month) {
      return { day: Number(dayFirst[1]), month: month.month, year: dayFirst[3] ? Number(dayFirst[3]) : undefined };
    }
  }
  const monthFirst = /^([^\d]+?)\.?\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?$/.exec(normalized);
  if (monthFirst) {
    const month = MONTHS.get(monthKey(monthFirst[1]));
    if (month) {
      return { day: Number(monthFirst[2]), month: month.month, year: monthFirst[3] ? Number(monthFirst[3]) : undefined };
    }
  }
  return null;
}

/**
 * Le uma data escrita pelo Notion. Devolve `null` quando nao da para ler; quem
 * chama decide o que fazer (relatorio, data de importacao, etc.).
 */
export function parseNotionDateText(raw: string, fallbackYear: number, locale = "pt-BR"): NotionDateValue | null {
  const original = raw;
  let value = clean(raw);
  if (!value) return null;
  // Um intervalo guarda a data inicial; a final nao vira nota.
  value = value.split(RANGE)[0]!.trim();
  if (!value) return null;

  const time = splitTime(value);
  const date = time.date;
  if (!date) return null;

  // ISO: 2025-11-17 ou 2025-11-17T15:57.
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(
    value,
  );
  if (iso) {
    if (iso[7]) {
      const absolute = new Date(value.replace(" ", "T"));
      if (!Number.isNaN(absolute.getTime())) {
        return { date: absolute, hadYear: true, hasTime: true, raw: original };
      }
    }
    const parsed = validDate(
      Number(iso[1]),
      Number(iso[2]),
      Number(iso[3]),
      iso[4] ? Number(iso[4]) : 12,
      iso[5] ? Number(iso[5]) : 0,
      iso[6] ? Number(iso[6]) : 0,
    );
    if (parsed) {
      return { date: parsed, hadYear: true, hasTime: Boolean(iso[4]), raw: original };
    }
  }

  // Data numerica: 17/11/2025, 11-17-2025, 17.11.2025.
  const numeric = numericDate(date, locale);
  if (numeric) {
    const parsed = validDate(numeric.year, numeric.month, numeric.day, time.hour, time.minute, time.second);
    if (parsed) {
      return { date: parsed, hadYear: true, hasTime: time.hasTime, raw: original };
    }
  }

  // Data com nome do mes, com ou sem ano.
  const named = namedDate(date);
  if (named) {
    const year = named.year ?? fallbackYear;
    const parsed = validDate(year, named.month, named.day, time.hour, time.minute, time.second);
    if (parsed) {
      return { date: parsed, hadYear: named.year !== undefined, hasTime: time.hasTime, raw: original };
    }
  }

  return null;
}

/** Le o <time> de uma propriedade. O atributo `datetime` tem prioridade. */
export function parseNotionDateElement(time: Element, fallbackYear: number, locale = "pt-BR"): NotionDateValue | null {
  const machine = (time.getAttribute("datetime") ?? "").trim();
  if (machine) {
    const parsed = parseNotionDateText(machine, fallbackYear, locale);
    if (parsed) {
      return { ...parsed, raw: (time.textContent ?? "").trim() || machine };
    }
  }
  return parseNotionDateText(time.textContent ?? "", fallbackYear, locale);
}

/** Ano do arquivo de export, usado quando o texto da data nao traz o ano. */
export function exportYear(date: Date | undefined): number {
  const year = date?.getFullYear() ?? 0;
  return year > 1980 ? year : new Date().getFullYear();
}

/** Converte a data local do Notion para o RFC 3339 que a API guarda. */
export function toRecordedAt(value: NotionDateValue | Date | null): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : value.date;
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
