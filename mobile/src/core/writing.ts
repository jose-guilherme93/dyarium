/**
 * Metricas dos textos (a escrita). Puro e testavel: recebe as notas e devolve
 * numeros e insights prontos para o Painel. Nada de rede: e a analise do que o
 * usuario escreveu (o corpo da nota) e do que foi transcrito (a fala), separado.
 */

import { displayTitle } from './title';
import type { Recording } from './types';

export interface WordCount {
  label: string;
  value: number;
}

export interface MonthlyPoint {
  /** Rotulo curto do mes (ex.: "out 26"). */
  label: string;
  words: number;
  notes: number;
}

export interface SentimentMetrics {
  /** Notas com texto analisadas. */
  analyzed: number;
  /** -1..1 (media dos textos; 0 = sem sinal). */
  average: number;
  positive: number;
  neutral: number;
  negative: number;
  topPositive: { title: string; score: number } | null;
  topNegative: { title: string; score: number } | null;
}

export interface WritingMetrics {
  /** Notas no total (locais). */
  notes: number;
  /** Notas com texto escrito. */
  withText: number;
  /** Notas com audio. */
  withAudio: number;
  /** Notas com transcricao. */
  withTranscript: number;

  /** Escrita (corpo das notas). */
  words: number;
  chars: number;
  sentences: number;
  paragraphs: number;
  uniqueWords: number;
  /** Palavras unicas / palavras (0..1). */
  lexicalRichness: number;
  averageWordsPerNote: number;
  averageSentenceWords: number;
  averageWordLength: number;
  /** Palavras mais usadas (sem palavras vazias). */
  topWords: WordCount[];
  /** Palavras mais longas (unicas). */
  longestWords: WordCount[];

  /** Marcadores no texto. */
  questions: number;
  exclamations: number;
  links: number;
  images: number;
  listItems: number;

  /** Fala (transcricoes de audio). */
  transcriptWords: number;
  averageTranscriptWords: number;

  /** Habito (notas, pela data do evento). */
  activeDays: number;
  averageNotesPerActiveDay: number;
  currentStreak: number;
  longestStreak: number;
  topWeekday: WordCount | null;
  topHour: WordCount | null;
  firstAt: string | null;
  lastAt: string | null;

  /** Destaques. */
  longestNote: { title: string; words: number } | null;

  /** Escreveu hoje (para avisar que a sequencia esta em risco). */
  wroteToday: boolean;

  /** Palavras por mes (mais antigo primeiro). */
  monthly: MonthlyPoint[];
  /** Variacao do mes atual vs o anterior (%, quando da pra comparar). */
  monthComparisonPct: number | null;

  /** Humor dos textos (lexico local). */
  sentiment: SentimentMetrics;

  /** Grade 7 (domingo..sabado) x 8 faixas de 3h: quantas notas por faixa. */
  weekdayHour: number[][];

  /** Frases prontas, derivadas dos numeros. */
  insights: string[];
}

/** Palavras vazias comuns do pt-BR (para nao poluir as palavras mais usadas). */
const STOPWORDS = new Set([
  'a', 'à', 'às', 'ao', 'aos', 'as', 'o', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da',
  'dos', 'das', 'em', 'no', 'na', 'nos', 'nas', 'por', 'para', 'pra', 'com', 'sem', 'sobre',
  'e', 'ou', 'mas', 'que', 'se', 'nao', 'sim', 'ja', 'eh', 'foi', 'ser', 'sao', 'esta', 'estao',
  'ter', 'tem', 'tinha', 'me', 'te', 'lhe', 'vos', 'ele', 'ela', 'eles', 'elas', 'eu', 'tu',
  'voce', 'voces', 'nos', 'meu', 'minha', 'seu', 'sua', 'dele', 'dela', 'isso', 'isto', 'aquilo',
  'aqui', 'ali', 'la', 'entao', 'porque', 'porque', 'quando', 'onde', 'como', 'qual', 'quais',
  'mais', 'menos', 'muito', 'muita', 'muitos', 'muitas', 'pouco', 'pouca', 'bem', 'mal',
  'tambem', 'so', 'apenas', 'ate', 'depois', 'antes', 'agora', 'hoje', 'ontem', 'amanha',
  'tudo', 'todo', 'toda', 'todos', 'todas', 'nada', 'nem', 'cada', 'outro', 'outra', 'outros',
  'outras', 'esse', 'essa', 'esses', 'essas', 'este', 'estes', 'estas', 'estou', 'estava',
  'estavam', 'vou', 'vai', 'vamos', 'foram', 'era', 'eram', 'ha', 'fazer', 'feito', 'tive',
  'ainda', 'sempre', 'nunca', 'talvez', 'coisa', 'coisas', 'gente', 'dia', 'dias', 'vez',
  'vezes', 'ficar', 'ficou', 'quer', 'quero', 'posso', 'pode', 'aqui',
]);

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
/** Faixas de 3 horas (8 por dia) para a grade dia x hora. */
const HOUR_STEP = 3;

/** Lexico simples de sentimento (pt-BR). Heuristica: nao entende negacao. */
const POSITIVE_WORDS = new Set([
  'bom', 'boa', 'otimo', 'otima', 'excelente', 'feliz', 'felicidade', 'alegre', 'alegria',
  'amor', 'amei', 'amo', 'adoro', 'adorei', 'gosto', 'gostei', 'legal', 'incrivel',
  'maravilhoso', 'maravilhosa', 'perfeito', 'perfeita', 'sucesso', 'conquista', 'conquistei',
  'vitoria', 'orgulho', 'orgulhoso', 'grato', 'grata', 'gratidao', 'obrigado', 'obrigada',
  'esperanca', 'animado', 'animada', 'empolgado', 'contente', 'satisfeito', 'tranquilo',
  'calmo', 'paz', 'saude', 'melhor', 'melhorei', 'evolui', 'evoluir', 'aprendi', 'aprendizado',
  'progresso', 'felizmente', 'recomendo', 'util', 'facil', 'divertido', 'engracado', 'bonito',
  'bonita', 'lindo', 'linda', 'forte', 'coragem', 'venci', 'consegui', 'parabens', 'top',
  'adoravel', 'confiante', 'motivado', 'agradecido', 'valeu', 'show', 'otimas', 'bons',
]);

const NEGATIVE_WORDS = new Set([
  'ruim', 'pessimo', 'pessima', 'horrivel', 'triste', 'tristeza', 'raiva', 'bravo', 'brava',
  'irritado', 'ansioso', 'ansiosa', 'ansiedade', 'medo', 'preocupado', 'preocupada',
  'preocupacao', 'problema', 'problemas', 'dificil', 'falhei', 'falha', 'fracasso', 'errado',
  'errada', 'erro', 'erros', 'perdi', 'perda', 'dor', 'doente', 'doenca', 'cansado', 'cansada',
  'exausto', 'estresse', 'estressado', 'chateado', 'chateada', 'decepcao', 'decepcionado',
  'sozinho', 'sozinha', 'solidao', 'odio', 'detesto', 'detestei', 'pior', 'piorou', 'arrependido',
  'culpa', 'inseguro', 'inseguranca', 'nervoso', 'nervosa', 'frustrado', 'frustracao', 'chorar',
  'chorei', 'sofri', 'sofrimento', 'morrer', 'morte', 'perdido', 'perdida', 'confuso', 'confusa',
  'demais', 'infeliz', 'pena', 'odeio', 'terrivel',
]);

/** Media 7 x 8 (faixas de 3h) de contagem de notas. */
function emptyGrid(): number[][] {
  return Array.from({ length: 7 }, () => Array.from({ length: 24 / HOUR_STEP }, () => 0));
}

/** Grade dia-da-semana x faixa de 3h (quantas notas por celula). */
export function weekdayHourGrid(recordings: Recording[]): number[][] {
  const grid = emptyGrid();
  for (const recording of recordings) {
    const date = new Date(recording.recordedAt);
    if (Number.isNaN(date.getTime())) continue;
    const bucket = Math.min(grid[0].length - 1, Math.floor(date.getHours() / HOUR_STEP));
    grid[date.getDay()][bucket] += 1;
  }
  return grid;
}

/** Palavras por mes (mais antigo primeiro), contando o corpo das notas. */
export function monthlySeries(
  recordings: Recording[],
  now: Date = new Date(),
  months = 6,
): MonthlyPoint[] {
  const totals = new Map<string, { words: number; notes: number; date: Date }>();
  for (const recording of recordings) {
    const date = new Date(recording.recordedAt);
    if (Number.isNaN(date.getTime())) continue;
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    const entry = totals.get(key) ?? {
      words: 0,
      notes: 0,
      date: new Date(date.getFullYear(), date.getMonth(), 1),
    };
    entry.notes += 1;
    entry.words += wordsOf(plainText(recording.text ?? '')).length;
    totals.set(key, entry);
  }

  const out: MonthlyPoint[] = [];
  const total = Math.max(1, months);
  for (let i = total - 1; i >= 0; i -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const entry = totals.get(`${date.getFullYear()}-${date.getMonth()}`);
    out.push({
      label: `${MONTHS[date.getMonth()]} ${String(date.getFullYear()).slice(2)}`,
      words: entry?.words ?? 0,
      notes: entry?.notes ?? 0,
    });
  }
  return out;
}

function sentimentScore(words: string[]): number {
  let positive = 0;
  let negative = 0;
  for (const word of words) {
    if (POSITIVE_WORDS.has(word)) positive += 1;
    else if (NEGATIVE_WORDS.has(word)) negative += 1;
  }
  const total = positive + negative;
  return total === 0 ? 0 : (positive - negative) / total;
}
const HOUR_BUCKETS: { label: string; from: number; to: number }[] = [
  { label: 'madrugada', from: 0, to: 5 },
  { label: 'manhã', from: 6, to: 11 },
  { label: 'tarde', from: 12, to: 17 },
  { label: 'noite', from: 18, to: 23 },
];

/** Tira markdown do texto, mantendo as palavras (mantem o rotulo dos links). */
export function plainText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, ' $1 ')
    .replace(/`{1,3}/g, ' ')
    .replace(/[*_#>]/g, ' ')
    .replace(/^\s*[-+]\s+/gm, ' ');
}

function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9à-ÿ]+/g) ?? [];
}

function dayKey(date: Date): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function countMarks(markdown: string): { questions: number; exclamations: number; links: number; images: number; listItems: number } {
  const images = (markdown.match(/!\[[^\]]*\]\(/g) ?? []).length;
  const linksAll = (markdown.match(/\[[^\]]*\]\(/g) ?? []).length;
  const questions = (markdown.match(/\?/g) ?? []).length;
  const bangs = (markdown.match(/!/g) ?? []).length;
  const listItems = (markdown.match(/^\s*[-+]\s+/gm) ?? []).length;
  return {
    questions,
    exclamations: Math.max(0, bangs - images),
    links: Math.max(0, linksAll - images),
    images,
    listItems,
  };
}

function average(total: number, count: number): number {
  return count > 0 ? total / count : 0;
}

/** Arredonda para 1 casa, sem `x.0`. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function analyzeWriting(recordings: Recording[], now: Date = new Date()): WritingMetrics {
  const frequency = new Map<string, number>();
  const dayCounts = new Map<string, number>();
  const wordLengths = new Map<string, number>();

  let withText = 0;
  let withAudio = 0;
  let withTranscript = 0;
  let words = 0;
  let chars = 0;
  let sentences = 0;
  let paragraphs = 0;
  let marks = { questions: 0, exclamations: 0, links: 0, images: 0, listItems: 0 };
  let transcriptWords = 0;
  let longestNote: { title: string; words: number } | null = null;
  let firstAt: string | null = null;
  let lastAt: string | null = null;
  let wroteToday = false;

  let sentimentSum = 0;
  let sentimentCount = 0;
  let positive = 0;
  let neutral = 0;
  let negative = 0;
  let topPositive: { title: string; score: number } | null = null;
  let topNegative: { title: string; score: number } | null = null;

  const todayKey = dayKey(now);

  for (const recording of recordings) {
    if (recording.filePath) withAudio += 1;

    const date = new Date(recording.recordedAt);
    if (!Number.isNaN(date.getTime())) {
      const key = dayKey(date);
      dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
      if (key === todayKey) wroteToday = true;
      if (!firstAt || recording.recordedAt < firstAt) firstAt = recording.recordedAt;
      if (!lastAt || recording.recordedAt > lastAt) lastAt = recording.recordedAt;
    }

    const raw = (recording.text ?? '').trim();
    if (raw) {
      withText += 1;
      const plain = plainText(raw);
      chars += plain.length;
      const list = wordsOf(plain);
      words += list.length;
      sentences += plain.split(/[.!?…]+/).filter((s) => s.trim().length > 0).length;
      paragraphs += raw.split(/\n{2,}/).filter((p) => p.trim().length > 0).length;
      for (const word of list) {
        frequency.set(word, (frequency.get(word) ?? 0) + 1);
        if (word.length >= 8) wordLengths.set(word, word.length);
      }
      const noteMarks = countMarks(raw);
      marks = {
        questions: marks.questions + noteMarks.questions,
        exclamations: marks.exclamations + noteMarks.exclamations,
        links: marks.links + noteMarks.links,
        images: marks.images + noteMarks.images,
        listItems: marks.listItems + noteMarks.listItems,
      };
      const title = displayTitle(recording);
      if (!longestNote || list.length > longestNote.words) {
        longestNote = { title, words: list.length };
      }
      // Humor (lexico local): so conta nota com texto.
      if (list.length > 0) {
        const score = sentimentScore(list);
        sentimentCount += 1;
        sentimentSum += score;
        if (score > 0.15) positive += 1;
        else if (score < -0.15) negative += 1;
        else neutral += 1;
        if (score > 0 && (!topPositive || score > topPositive.score)) {
          topPositive = { title, score };
        }
        if (score < 0 && (!topNegative || score < topNegative.score)) {
          topNegative = { title, score };
        }
      }
    }

    const transcript = (recording.transcript ?? '').trim();
    if (transcript) {
      withTranscript += 1;
      transcriptWords += wordsOf(plainText(transcript)).length;
    }
  }

  const uniqueWords = frequency.size;
  const topWords = [...frequency.entries()]
    .filter(([word]) => !STOPWORDS.has(word))
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);

  const longestWords = [...wordLengths.keys()]
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .slice(0, 8)
    .map((word) => ({ label: word, value: word.length }));

  const days = [...dayCounts.keys()].sort();

  // Dias com registro e sequencias (streak atual e a maior).
  let longestStreak = 0;
  let run = 0;
  let previous: number | null = null;
  const daySet = new Set(days);
  for (const key of days) {
    const time = new Date(`${key}T00:00:00`).getTime();
    run = previous !== null && time - previous === 86_400_000 ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    previous = time;
  }
  let currentStreak = 0;
  const startFromNow = daySet.has(dayKey(now))
    ? now
    : daySet.has(dayKey(new Date(now.getTime() - 86_400_000)))
      ? new Date(now.getTime() - 86_400_000)
      : null;
  if (startFromNow) {
    let cursor = startFromNow;
    while (daySet.has(dayKey(cursor))) {
      currentStreak += 1;
      cursor = new Date(cursor.getTime() - 86_400_000);
    }
  }

  // Habito: dia da semana e faixa de hora (pelos eventos).
  const weekdayCounts = new Array(7).fill(0) as number[];
  const hourCounts = HOUR_BUCKETS.map(() => 0);
  for (const recording of recordings) {
    const date = new Date(recording.recordedAt);
    if (Number.isNaN(date.getTime())) continue;
    weekdayCounts[date.getDay()] += 1;
    const bucket = HOUR_BUCKETS.findIndex((b) => date.getHours() >= b.from && date.getHours() <= b.to);
    if (bucket >= 0) hourCounts[bucket] += 1;
  }
  const topWeekdayIndex = weekdayCounts.indexOf(Math.max(...weekdayCounts));
  const topHourIndex = hourCounts.indexOf(Math.max(...hourCounts));
  const topWeekday =
    recordings.length > 0 && weekdayCounts[topWeekdayIndex] > 0
      ? { label: WEEKDAYS[topWeekdayIndex], value: weekdayCounts[topWeekdayIndex] }
      : null;
  const topHour =
    recordings.length > 0 && hourCounts[topHourIndex] > 0
      ? { label: HOUR_BUCKETS[topHourIndex].label, value: hourCounts[topHourIndex] }
      : null;

  const totalWordLength = [...frequency.entries()].reduce(
    (sum, [word, count]) => sum + word.length * count,
    0,
  );

  const monthly = monthlySeries(recordings, now, 6);
  const previousMonth = monthly[monthly.length - 2];
  const currentMonth = monthly[monthly.length - 1];
  const monthComparisonPct =
    previousMonth && previousMonth.words > 0 && currentMonth
      ? Math.round(((currentMonth.words - previousMonth.words) / previousMonth.words) * 100)
      : null;

  const metrics: WritingMetrics = {
    notes: recordings.length,
    withText,
    withAudio,
    withTranscript,
    words,
    chars,
    sentences,
    paragraphs,
    uniqueWords,
    lexicalRichness: words > 0 ? uniqueWords / words : 0,
    averageWordsPerNote: round1(average(words, withText)),
    averageSentenceWords: round1(average(words, sentences)),
    averageWordLength: round1(average(totalWordLength, words)),
    topWords,
    longestWords,
    questions: marks.questions,
    exclamations: marks.exclamations,
    links: marks.links,
    images: marks.images,
    listItems: marks.listItems,
    transcriptWords,
    averageTranscriptWords: round1(average(transcriptWords, withTranscript)),
    activeDays: days.length,
    averageNotesPerActiveDay: round1(average(recordings.length, days.length)),
    currentStreak,
    longestStreak,
    topWeekday,
    topHour,
    firstAt,
    lastAt,
    longestNote,
    wroteToday,
    monthly,
    monthComparisonPct,
    sentiment: {
      analyzed: sentimentCount,
      average: sentimentCount > 0 ? sentimentSum / sentimentCount : 0,
      positive,
      neutral,
      negative,
      topPositive,
      topNegative,
    },
    weekdayHour: weekdayHourGrid(recordings),
    insights: [],
  };

  metrics.insights = buildInsights(metrics);
  return metrics;
}

function buildInsights(metrics: WritingMetrics): string[] {
  const out: string[] = [];
  if (metrics.withText > 0) {
    const notes = `${metrics.withText} nota${metrics.withText === 1 ? '' : 's'}`;
    out.push(
      `Você escreveu ${metrics.words.toLocaleString('pt-BR')} palavras em ${notes} — cerca de ${metrics.averageWordsPerNote} por nota.`,
    );
    if (metrics.uniqueWords > 0) {
      out.push(
        `Seu vocabulário tem ${metrics.uniqueWords.toLocaleString('pt-BR')} palavras diferentes (riqueza de ${Math.round(metrics.lexicalRichness * 100)}%).`,
      );
    }
    if (metrics.topWords[0]) {
      out.push(`A palavra que mais aparece é “${metrics.topWords[0].label}” (${metrics.topWords[0].value}×).`);
    }
  }
  if (metrics.activeDays > 0) {
    out.push(
      `Você registrou em ${metrics.activeDays} dia${metrics.activeDays === 1 ? '' : 's'}; a maior sequência foi de ${metrics.longestStreak} dia${metrics.longestStreak === 1 ? '' : 's'}${metrics.currentStreak > 0 ? ` (atual: ${metrics.currentStreak})` : ''}.`,
    );
  }
  if (metrics.topWeekday && metrics.topHour) {
    out.push(`Você escreve mais na ${metrics.topWeekday.label} e pela ${metrics.topHour.label}.`);
  }
  if (metrics.questions > 0 || metrics.exclamations > 0) {
    const parts: string[] = [];
    if (metrics.questions > 0) parts.push(`${metrics.questions} pergunta${metrics.questions === 1 ? '' : 's'}`);
    if (metrics.exclamations > 0) parts.push(`${metrics.exclamations} exclamação${metrics.exclamations === 1 ? '' : 'ões'}`);
    out.push(`Nos seus textos há ${parts.join(' e ')}.`);
  }
  if (metrics.images > 0 || metrics.links > 0) {
    const parts: string[] = [];
    if (metrics.images > 0) parts.push(`${metrics.images} imagem${metrics.images === 1 ? '' : 's'}`);
    if (metrics.links > 0) parts.push(`${metrics.links} link${metrics.links === 1 ? '' : 's'}`);
    out.push(`Você anexou ${parts.join(' e ')}.`);
  }
  if (metrics.longestNote && metrics.longestNote.words > 0) {
    out.push(
      `Sua nota mais longa tem ${metrics.longestNote.words.toLocaleString('pt-BR')} palavras: “${metrics.longestNote.title}”.`,
    );
  }
  if (metrics.transcriptWords > 0) {
    out.push(
      `Suas gravações transcritas somam ${metrics.transcriptWords.toLocaleString('pt-BR')} palavras faladas (${metrics.averageTranscriptWords} por gravação).`,
    );
  }
  if (metrics.monthComparisonPct !== null) {
    const pct = metrics.monthComparisonPct;
    if (pct > 5) out.push(`Você escreveu ${pct}% mais que no mês passado.`);
    else if (pct < -5) out.push(`Você escreveu ${Math.abs(pct)}% menos que no mês passado.`);
    else out.push('Seu ritmo está parecido com o do mês passado.');
  }
  if (metrics.sentiment.analyzed > 0) {
    const { average, positive, negative, analyzed } = metrics.sentiment;
    const tone = average > 0.15 ? 'positivo' : average < -0.15 ? 'negativo' : 'neutro';
    out.push(
      `O tom dos seus textos tende a ${tone} (${Math.round((positive / analyzed) * 100)}% positivos, ${Math.round((negative / analyzed) * 100)}% negativos).`,
    );
  }
  if (metrics.currentStreak > 0 && !metrics.wroteToday) {
    out.push(
      `Sua sequência de ${metrics.currentStreak} dia${metrics.currentStreak === 1 ? '' : 's'} está em risco: ainda não escreveu hoje.`,
    );
  }
  return out;
}

// --- Historico (para os graficos) -------------------------------------------

export interface WeeklyPoint {
  /** Rotulo curto (DD/MM) do inicio da semana. */
  label: string;
  words: number;
  notes: number;
}

export interface DayCell {
  /** Chave da data (YYYY-MM-DD); null quando o dia ainda nao chegou. */
  key: string | null;
  words: number;
  notes: number;
}

export interface WritingHistory {
  /** Palavras por semana (mais antiga primeiro). */
  weekly: WeeklyPoint[];
  /** Colunas (semanas) de 7 dias, de domingo a sabado. */
  calendar: DayCell[][];
  /** Maior volume semanal (para escalar as barras). */
  maxWeekly: number;
  /** Maior volume diario (para escalar o mapa). */
  maxDaily: number;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Domingo da semana da data. */
function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  return addDays(day, -day.getDay());
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * Serie semanal + calendario (para os graficos do Painel). Semana comeca no
 * domingo; o calendario vai da semana mais antiga ate a atual.
 */
export function writingHistory(
  recordings: Recording[],
  now: Date = new Date(),
  weeks = 12,
): WritingHistory {
  const counts = new Map<string, { words: number; notes: number }>();
  for (const recording of recordings) {
    const date = new Date(recording.recordedAt);
    if (Number.isNaN(date.getTime())) continue;
    const key = dayKey(date);
    const entry = counts.get(key) ?? { words: 0, notes: 0 };
    entry.notes += 1;
    entry.words += wordsOf(plainText(recording.text ?? '')).length;
    counts.set(key, entry);
  }

  const today = startOfDay(now);
  const currentWeekStart = startOfWeek(now);
  const weekly: WeeklyPoint[] = [];
  const calendar: DayCell[][] = [];
  let maxWeekly = 0;
  let maxDaily = 0;

  const total = Math.max(1, weeks);
  for (let i = total - 1; i >= 0; i -= 1) {
    const weekStart = addDays(currentWeekStart, -i * 7);
    let words = 0;
    let notes = 0;
    const column: DayCell[] = [];
    for (let d = 0; d < 7; d += 1) {
      const day = addDays(weekStart, d);
      const future = day.getTime() > today.getTime();
      const key = future ? null : dayKey(day);
      const cell = (key ? counts.get(key) : undefined) ?? { words: 0, notes: 0 };
      column.push({ key, words: cell.words, notes: cell.notes });
      words += cell.words;
      notes += cell.notes;
      if (!future) maxDaily = Math.max(maxDaily, cell.words);
    }
    weekly.push({
      label: `${pad2(weekStart.getDate())}/${pad2(weekStart.getMonth() + 1)}`,
      words,
      notes,
    });
    maxWeekly = Math.max(maxWeekly, words);
    calendar.push(column);
  }

  return { weekly, calendar, maxWeekly, maxDaily };
}

// --- Lembretes (notificacoes) -----------------------------------------------

export interface WritingReminder {
  kind: 'streak' | 'goal';
  title: string;
  body: string;
}

/** Marco de palavras comemorado (cresce em degraus). */
const WORD_MILESTONES = [1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000];

/** Maior marco de palavras ja alcancado e ainda nao comemorado, ou null. */
export function wordMilestone(words: number, celebrated: number): number | null {
  let reached: number | null = null;
  for (const mark of WORD_MILESTONES) {
    if (words >= mark && mark > celebrated) reached = mark;
  }
  return reached;
}

/**
 * Decide o lembrete de escrita (ou null). Prioriza a sequencia em risco; senao,
 * cobra a meta semanal so no fim da semana (quinta em diante, semana domingo-sabado).
 */
export function writingReminder(input: {
  metrics: WritingMetrics;
  weeklyWords: number;
  goal: number;
  now: Date;
}): WritingReminder | null {
  const { metrics, weeklyWords, goal, now } = input;
  if (metrics.notes === 0) return null;

  if (!metrics.wroteToday && metrics.currentStreak > 0) {
    const days = metrics.currentStreak;
    return {
      kind: 'streak',
      title: 'Sua sequência está em risco',
      body: `Você está há ${days} dia${days === 1 ? '' : 's'} seguidos escrevendo. Escreva um pouco hoje para não perder.`,
    };
  }

  const lateWeek = now.getDay() >= 4; // quinta em diante
  if (goal > 0 && weeklyWords < goal && lateWeek) {
    const missing = goal - weeklyWords;
    return {
      kind: 'goal',
      title: 'Meta da semana',
      body: `Faltam ${missing.toLocaleString('pt-BR')} palavras para a sua meta desta semana.`,
    };
  }

  return null;
}

