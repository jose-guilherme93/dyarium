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

  for (const recording of recordings) {
    if (recording.filePath) withAudio += 1;

    const date = new Date(recording.recordedAt);
    if (!Number.isNaN(date.getTime())) {
      const key = dayKey(date);
      dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
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
      if (!longestNote || list.length > longestNote.words) {
        longestNote = { title: displayTitle(recording), words: list.length };
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
  return out;
}
