/**
 * Relogio hibrido logico (HLC) do aparelho e leitura de versao. Nucleo puro:
 * nada de banco nem rede, para poder testar a ordem so com strings.
 *
 * A versao de um campo e opaca. Antes era o horario do servidor em RFC3339; agora
 * e `physical-counter-node`, emitida pelo relogio de quem gravou. O formato tem
 * largura fixa, entao comparar as strings ja da a ordem certa, e a comparacao
 * semantica aceita as duas formas — versao antiga continua valendo.
 *
 * A vantagem sobre o horario puro: quando o aparelho le uma versao do servidor, o
 * relogio local avanca para ela. Uma edicao feita depois vence a leitura mesmo
 * com o relogio do aparelho atrasado, que era o caso em que a edicao local
 * parecia antiga para sempre e acabava sobrescrita.
 */

const PHYSICAL_DIGITS = 15;
const COUNTER_DIGITS = 6;

export interface Hlc {
  /** Relogio de parede em milissegundos. */
  physical: number;
  /** Desempate dentro do mesmo milissegundo. */
  counter: number;
  /** Quem emitiu (ambiente ou aparelho). */
  node: string;
}

/** Formata um stamp no mesmo formato do servidor. */
export function formatHlc(stamp: Hlc): string {
  const physical = String(Math.max(0, Math.trunc(stamp.physical))).padStart(PHYSICAL_DIGITS, '0');
  const counter = String(Math.max(0, Math.trunc(stamp.counter))).padStart(COUNTER_DIGITS, '0');
  return `${physical}-${counter}-${stamp.node}`;
}

/**
 * Le uma versao. Aceita o formato do relogio hibrido e o RFC3339 antigo (que
 * vira um stamp sem contador nem no). Devolve `null` para lixo.
 */
export function parseHlc(value: string | null | undefined): Hlc | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  const first = text.indexOf('-');
  const second = first < 0 ? -1 : text.indexOf('-', first + 1);
  if (first === PHYSICAL_DIGITS && second === first + 1 + COUNTER_DIGITS) {
    const physical = Number(text.slice(0, first));
    const counter = Number(text.slice(first + 1, second));
    if (Number.isFinite(physical) && Number.isFinite(counter)) {
      return { physical, counter, node: text.slice(second + 1) };
    }
    return null;
  }
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) return null;
  return { physical: parsed, counter: 0, node: '' };
}

/** Ordem total: -1 quando `a` e mais antigo, 1 quando e mais novo, 0 igual. */
export function compareHlc(a: Hlc, b: Hlc): number {
  if (a.physical !== b.physical) return a.physical < b.physical ? -1 : 1;
  if (a.counter !== b.counter) return a.counter < b.counter ? -1 : 1;
  if (a.node !== b.node) return a.node < b.node ? -1 : 1;
  return 0;
}

/** `a` e estritamente mais novo que `b`? Versao ilegivel nunca vence. */
export function versionAfter(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = parseHlc(a);
  const right = parseHlc(b);
  if (!left || !right) return false;
  return compareHlc(left, right) > 0;
}

/** Instante (ms) de uma versao, para ordenar listas e comparar com datas. */
export function versionTime(value: string | null | undefined): number {
  return parseHlc(value)?.physical ?? 0;
}

/**
 * A versao mais nova entre varias referencias (versoes de campos e datas). Serve
 * para marcar a nota inteira com o instante da ultima mudanca que o app viu,
 * sem inventar um stamp local quando o dado veio do servidor.
 */
export function latestVersion(...values: (string | null | undefined)[]): string | undefined {
  let best: Hlc | null = null;
  for (const value of values) {
    const parsed = parseHlc(value);
    if (parsed && (!best || compareHlc(parsed, best) > 0)) best = parsed;
  }
  return best ? formatHlc(best) : undefined;
}

/**
 * Proximo stamp do relogio local a partir do estado anterior. O fisico segue o
 * relogio de parede enquanto ele anda para frente; parado ou voltando, o
 * contador avanca — o stamp nunca repete e nunca regride.
 */
export function nextHlc(last: Hlc | null, wallMs: number, node: string): Hlc {
  if (!last) return { physical: wallMs, counter: 0, node };
  if (wallMs > last.physical) return { physical: wallMs, counter: 0, node };
  return { physical: last.physical, counter: last.counter + 1, node };
}

/** Merge de recebimento: o relogio local avanca ate onde o outro chegou. */
export function observeHlc(last: Hlc | null, remote: Hlc): Hlc | null {
  if (!last) return remote;
  return compareHlc(remote, last) > 0 ? remote : last;
}
