/** Formatacao de valores para a interface. Puro e testavel. */

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  const decimals = value >= 100 || i === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[i]}`;
}

/**
 * Data que representa a nota: a do evento (`recordedAt`), com fallback para a
 * criacao. Audio importado entra no dia em que foi gravado, nao no dia da
 * importacao.
 */
export function noteDateIso(note: { recordedAt?: string; createdAt?: string }): string {
  const recorded = note.recordedAt?.trim();
  if (recorded && !Number.isNaN(new Date(recorded).getTime())) return recorded;
  return note.createdAt?.trim() ?? '';
}

/**
 * Data exibida abaixo do titulo. Fica nula quando o titulo ja e exatamente essa
 * data (titulo padrao de audio), para nao duplicar.
 */
export function noteDateLabel(
  title: string,
  note: { recordedAt?: string; createdAt?: string },
): string | null {
  const date = formatDateTime(noteDateIso(note));
  if (!date) return null;
  return title.trim() === date ? null : date;
}

/** Data e hora em DD/MM/AAAA HH:mm (24h). Vazio quando a data e invalida. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/**
 * Data curta para o canto do card (estilo mensagem): hoje mostra so a hora,
 * no mesmo ano mostra dia/mes e hora, senao a data completa.
 */
export function formatStamp(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return time;
  const day = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
  if (date.getFullYear() === now.getFullYear()) return `${day} ${time}`;
  return `${day}/${date.getFullYear()}`;
}

/** Tamanho em bytes de um texto UTF-8 (para a ficha da nota). */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code < 0x10000) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

/**
 * Fonte do titulo conforme o comprimento: titulo longo diminui um pouco para
 * caber melhor, mas o campo quebra linha (nao some). O piso fica alto o
 * bastante para o titulo continuar legivel mesmo quando ocupa duas linhas.
 */
export function titleFontSize(title: string, base = 34, min = 24): number {
  const extra = Math.max(0, title.trim().length - 20);
  return Math.max(min, base - Math.floor(extra / 10));
}

/** Duracao em mm:ss (ou h:mm:ss). */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

const WEEKDAYS = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
] as const;

const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

/**
 * Data e hora de agora para a tela de gravacao: dia da semana + data por
 * extenso e hora 24 h. A hora corrente situa quem vai falar (o dia da semana
 * costuma entrar na fala); o cronometro da gravacao e outra coisa.
 */
export function formatClock(now: Date): { date: string; time: string } {
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return {
    date: `${WEEKDAYS[now.getDay()]}, ${now.getDate()} de ${MONTHS[now.getMonth()]}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
}
