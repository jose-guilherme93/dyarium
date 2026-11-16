/**
 * Formatacao de datas e contagens da superficie Projetos. Tudo em UTC: o fence
 * guarda `date`/`time` em UTC e os dois clientes precisam chegar ao mesmo
 * rotulo. Sem paragrafo na tela: so rotulo curto e numero.
 */

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const dayMs = 864e5;

/** Dia de calendario como numero (dias desde a epoch); NaN se a data e inválida. */
export function dayNumber(date: string): number {
  const parts = date.split('-').map(Number);
  if (parts.length < 3 || parts.some((part) => Number.isNaN(part))) return Number.NaN;
  return Date.UTC(parts[0], parts[1] - 1, parts[2]) / dayMs;
}

/** "9 nov" a partir de "AAAA-MM-DD". */
export function shortDate(date: string): string {
  const day = dayNumber(date);
  if (Number.isNaN(day)) return date;
  const d = new Date(day * dayMs);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Faixa curta entre dois dias: mesmo mes vira "4-13 nov". */
export function shortRange(from: string, to: string): string {
  const a = dayNumber(from);
  const b = dayNumber(to);
  if (Number.isNaN(a) || Number.isNaN(b) || from === to) return shortDate(from);
  const da = new Date(a * dayMs);
  const db = new Date(b * dayMs);
  if (da.getUTCMonth() === db.getUTCMonth()) {
    return `${da.getUTCDate()}\u2013${db.getUTCDate()} ${MONTHS[db.getUTCMonth()]}`;
  }
  return `${shortDate(from)} \u2013 ${shortDate(to)}`;
}

/** `3 itens` / `1 item`; o numero vem na frente. */
export function itensLabel(count: number): string {
  return `${count} ${count === 1 ? 'item' : 'itens'}`;
}

/** `4 sessoes` / `1 sessao`. */
export function sessoesLabel(count: number): string {
  return `${count} ${count === 1 ? 'sessão' : 'sessões'}`;
}

/** `12 nov 09:12`, no UTC do fence; a hora vem como `HH:MM(:SS)`. */
export function stamp(date: string, time: string): string {
  return `${shortDate(date)} ${time.slice(0, 5)}`;
}

/** Instantaneo RFC 3339 do fence como `12 nov 14:02`, em UTC. */
export function instant(iso: string | undefined): string {
  if (typeof iso !== 'string' || iso.length < 16) return '';
  return `${shortDate(iso.slice(0, 10))} ${iso.slice(11, 16)}`;
}

/** Nome da sessao: o titulo da nota; sem ele, o id da sessao. */
export function sessionName(title: string | undefined, fallback: string): string {
  const value = (title ?? '').trim();
  return value !== '' ? value : fallback;
}
