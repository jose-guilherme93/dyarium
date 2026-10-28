import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Spinner } from "../components/Status";
import type {
  MetricsConsistency,
  MetricsEmotion,
  MetricsRankedCount,
  MetricsSeriesPoint,
  MetricsSnapshot,
  MetricsSnapshotV1,
  MetricsSnapshotV2,
  MetricsWordCount,
} from "../types";

/**
 * Painel "Escrita": mostra as métricas que o app calcula offline. O celular
 * envia o documento pronto (contrato em docs/api.md); aqui so desenhamos, sem
 * recalcular nada, para os numeros baterem exatamente com o app.
 */

const WEEKDAY_INITIALS = ["D", "S", "T", "Q", "Q", "S", "S"];
const HOUR_LABELS = ["0h", "3h", "6h", "9h", "12h", "15h", "18h", "21h"];

const WINDOW_KEYS = ["7d", "30d", "365d"] as const;
type WindowKey = (typeof WINDOW_KEYS)[number];
const WINDOW_LABELS: Record<WindowKey, string> = {
  "7d": "7 dias",
  "30d": "30 dias",
  "365d": "ano",
};

/**
 * Formato comum do que a tela desenha. O schema 1 (todas as notas) e o schema 2
 * (janela escolhida) entram no mesmo molde, para o JSX ser um so.
 */
interface ViewWriting {
  notes: number;
  with_text: number;
  words: number;
  chars: number;
  sentences: number;
  paragraphs: number;
  unique_words: number;
  lexical_richness: number;
  average_words_per_note: number;
  average_sentence_words: number;
  average_word_length: number;
  transcript_words: number;
  insights: string[];
  consistency: MetricsConsistency;
  monthly: MetricsSeriesPoint[];
  month_comparison_pct: number | null;
  weekday_hour: number[][];
  current_streak: number;
  longest_streak: number;
  active_days: number;
  average_notes_per_active_day: number;
  wrote_today: boolean;
  top_weekday: MetricsWordCount | null;
  top_hour: MetricsWordCount | null;
  top_words: MetricsWordCount[];
  longest_words: MetricsWordCount[];
  questions: number;
  exclamations: number;
  links: number;
  images: number;
  list_items: number;
}

interface ViewSentiment {
  analyzed: number;
  average: number;
  positive: number;
  neutral: number;
  negative: number;
  top_positive: { title: string; score: number } | null;
  top_negative: { title: string; score: number } | null;
  source?: "analysis" | "lexical";
  emotions?: MetricsEmotion[];
}

/** Schema 1: um retrato de todas as notas, como o app envia hoje. */
function legacyWriting(snapshot: MetricsSnapshotV1): ViewWriting {
  const writing = snapshot.writing;
  return {
    notes: writing.notes,
    with_text: writing.with_text,
    words: writing.words,
    chars: writing.chars,
    sentences: writing.sentences,
    paragraphs: writing.paragraphs,
    unique_words: writing.unique_words,
    lexical_richness: writing.lexical_richness,
    average_words_per_note: writing.average_words_per_note,
    average_sentence_words: writing.average_sentence_words,
    average_word_length: writing.average_word_length,
    transcript_words: writing.transcript_words,
    insights: writing.insights,
    consistency: writing.consistency,
    monthly: writing.monthly,
    month_comparison_pct: writing.month_comparison_pct,
    weekday_hour: writing.weekday_hour,
    current_streak: writing.current_streak,
    longest_streak: writing.longest_streak,
    active_days: writing.active_days,
    average_notes_per_active_day: writing.average_notes_per_active_day,
    wrote_today: writing.wrote_today,
    top_weekday: writing.top_weekday,
    top_hour: writing.top_hour,
    top_words: writing.top_words,
    longest_words: writing.longest_words,
    questions: writing.questions,
    exclamations: writing.exclamations,
    links: writing.links,
    images: writing.images,
    list_items: writing.list_items,
  };
}

/** Schema 2: a janela escolhida; a sequencia continua global. */
function windowWriting(snapshot: MetricsSnapshotV2, key: WindowKey): ViewWriting {
  const window = snapshot.windows[key];
  const writing = window.writing;
  return {
    notes: writing.notes,
    with_text: writing.with_text,
    words: writing.words,
    chars: writing.chars,
    sentences: writing.sentences,
    paragraphs: writing.paragraphs,
    unique_words: writing.unique_words,
    lexical_richness: writing.lexical_richness,
    average_words_per_note: writing.average_words_per_note,
    average_sentence_words: writing.average_sentence_words,
    average_word_length: writing.average_word_length,
    transcript_words: window.voice.words,
    insights: window.summary,
    consistency: writing.consistency,
    monthly: [],
    month_comparison_pct: null,
    weekday_hour: writing.weekday_hour,
    current_streak: snapshot.streak.current,
    longest_streak: snapshot.streak.longest,
    active_days: writing.active_days,
    average_notes_per_active_day: writing.average_notes_per_active_day,
    wrote_today: snapshot.streak.wrote_today,
    top_weekday: writing.top_weekday,
    top_hour: writing.top_hour,
    top_words: writing.top_words,
    longest_words: writing.longest_words,
    questions: writing.questions,
    exclamations: writing.exclamations,
    links: writing.links,
    images: writing.images,
    list_items: writing.list_items,
  };
}

function toneArrow(tone: MetricsEmotion["tone"]): string {
  if (tone === "positive") return "↑";
  if (tone === "negative") return "↓";
  return "·";
}

function toneClass(tone: MetricsEmotion["tone"]): string {
  if (tone === "positive") return "tone tone--up";
  if (tone === "negative") return "tone tone--down";
  return "tone";
}

function number(value: number): string {
  return value.toLocaleString("pt-BR");
}

function shortDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/** Parte sobre o total, em porcentagem inteira e sem passar de 100. */
function percentOf(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((part / total) * 100));
}

function bytes(value: number): string {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function topicRow(title: string, items: MetricsRankedCount[]) {
  if (items.length === 0) return null;
  return (
    <>
      <p className="muted">{title}</p>
      <ul className="chip-list">
        {items.map((item) => (
          <li className="chip" key={item.label}>
            {item.label} · {item.count}
          </li>
        ))}
      </ul>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  );
}

function BarSeries({
  title,
  caption,
  points,
  labelEvery = 3,
}: {
  title: string;
  caption?: string;
  points: { label: string; value: number }[];
  labelEvery?: number;
}) {
  const max = Math.max(1, ...points.map((point) => point.value));
  return (
    <div className="chart-card">
      <h3 className="chart-title">{title}</h3>
      {caption ? <p className="muted">{caption}</p> : null}
      <div className="chart-bars" role="img" aria-label={title}>
        {points.map((point, index) => (
          <span className="chart-slot" key={index} title={`${point.label}: ${number(point.value)}`}>
            <span
              className="chart-bar"
              style={{ height: point.value > 0 ? `${Math.max(3, Math.round((point.value / max) * 100))}%` : "2px" }}
            />
          </span>
        ))}
      </div>
      {labelEvery > 0 ? (
        <div className="chart-labels" aria-hidden="true">
          {points.map((point, index) => (
            <span className="chart-label" key={index}>
              {index % labelEvery === 0 ? point.label : ""}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Niveis do mapa de calor (0 = sem escrita, 4 = muito). */
const HEAT = ["#1f2933", "#7fa5c4", "#4d7fa8", "#2c5f88", "#17395c"];

function heatColor(value: number, max: number): string {
  if (value <= 0) return HEAT[0];
  const level = Math.min(4, Math.max(1, Math.ceil((value / Math.max(1, max)) * 4)));
  return HEAT[level];
}

export function WritingView({ refreshKey }: { refreshKey: number }) {
  const [snapshots, setSnapshots] = useState<MetricsSnapshot[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [windowKey, setWindowKey] = useState<WindowKey>("30d");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await api.getMetrics();
      const list = result.snapshots ?? [];
      setSnapshots(list);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao carregar as métricas");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const snapshot =
    snapshots.find((item) => item.device_id === selected) ?? snapshots[0];

  if (loading && snapshots.length === 0) {
    return (
      <section className="view">
        <header className="page-head">
          <div>
            <h1>Escrita</h1>
          </div>
        </header>
        <p className="muted">
          <Spinner /> Carregando...
        </p>
      </section>
    );
  }

  return (
    <section className="view">
      <header className="page-head">
        <div>
          <h1>Escrita</h1>
          <p>
            Métricas calculadas no aparelho, sobre as suas notas. O dashboard só desenha os números.
          </p>
        </div>
        <button type="button" className="button button--ghost" onClick={() => void load()}>
          Atualizar
        </button>
      </header>

      {error ? <p className="error">{error}</p> : null}

      {!snapshot ? (
        <div className="empty-state">
          <p>Nenhuma métrica recebida ainda.</p>
          <p>
            Abra o app no aparelho com o servidor configurado: as métricas de escrita são
            calculadas no próprio celular e enviadas para cá.
          </p>
        </div>
      ) : (
        <WritingBody
          snapshot={snapshot}
          devices={snapshots}
          onSelect={setSelected}
          windowKey={windowKey}
          onWindow={setWindowKey}
        />
      )}
    </section>
  );
}

function WritingBody({
  snapshot,
  devices,
  onSelect,
  windowKey,
  onWindow,
}: {
  snapshot: MetricsSnapshot;
  devices: MetricsSnapshot[];
  onSelect: (deviceId: string) => void;
  windowKey: WindowKey;
  onWindow: (key: WindowKey) => void;
}) {
  const writing = snapshot.schema === 2 ? windowWriting(snapshot, windowKey) : legacyWriting(snapshot);
  const history = snapshot.history;
  const comparison = writing.month_comparison_pct;
  const percent = Math.round(writing.consistency.rate * 100);
  const sentiment: ViewSentiment =
    snapshot.schema === 2 ? snapshot.windows[windowKey].sentiment : snapshot.writing.sentiment;
  const voice = snapshot.schema === 2 ? snapshot.windows[windowKey].voice : null;
  const topics = snapshot.schema === 2 ? snapshot.windows[windowKey].topics : null;
  const images = snapshot.schema === 2 ? snapshot.windows[windowKey].images : null;

  return (
    <>
      <div className="writing-meta">
        {devices.length > 1 ? (
          <label className="writing-device">
            <span className="muted">Aparelho</span>
            <select value={snapshot.device_id} onChange={(event) => onSelect(event.target.value)}>
              {devices.map((item) => (
                <option key={item.device_id} value={item.device_id}>
                  {item.device_name || item.device_id}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="muted">{snapshot.device_name || snapshot.device_id}</span>
        )}
        <span className="muted">
          Calculado no aparelho em {shortDate(snapshot.generated_at)} · recebido em{" "}
          {shortDate(snapshot.received_at)} · schema {snapshot.schema}
        </span>
      </div>

      {snapshot.schema === 2 ? (
        <div className="window-filter" role="group" aria-label="Janela">
          {WINDOW_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className={key === windowKey ? "window-chip window-chip--active" : "window-chip"}
              onClick={() => onWindow(key)}
              aria-pressed={key === windowKey}
            >
              {WINDOW_LABELS[key]}
            </button>
          ))}
        </div>
      ) : null}

      <div className="metric-grid">
        <Metric label="Palavras" value={number(writing.words)} />
        <Metric label="Notas" value={number(writing.notes)} />
        <Metric label="Com texto" value={number(writing.with_text)} />
        <Metric label="Caracteres" value={number(writing.chars)} />
        <Metric label="Frases" value={number(writing.sentences)} />
        <Metric label="Parágrafos" value={number(writing.paragraphs)} />
        <Metric label="Vocabulário" value={number(writing.unique_words)} />
        <Metric label="Riqueza" value={`${Math.round(writing.lexical_richness * 100)}%`} />
        <Metric label="Palavras por nota" value={String(writing.average_words_per_note)} />
        <Metric label="Palavras por frase" value={String(writing.average_sentence_words)} />
        <Metric label="Letras por palavra" value={String(writing.average_word_length)} />
        <Metric label="Palavras faladas" value={number(writing.transcript_words)} />
      </div>

      {writing.insights.length > 0 ? (
        <div className="chart-card">
          <h3 className="chart-title">{snapshot.schema === 2 ? "Resumo" : "Insights"}</h3>
          <ul className="insight-list">
            {writing.insights.map((text, index) => (
              <li key={index}>{text}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="chart-grid">
        {history && history.weekly.length > 0 ? (
          <BarSeries
            title="Palavras por semana"
            points={history.weekly.map((week) => ({ label: week.label, value: week.words }))}
          />
        ) : null}

        {writing.consistency.days.length > 0 ? (
          <BarSeries
            title="Palavras por dia"
            caption={`Escrita em ${writing.consistency.written_days} de ${writing.consistency.tracked_days} dias (${percent}%)`}
            points={writing.consistency.days.map((day) => ({
              label: `${day.key.slice(8, 10)}/${day.key.slice(5, 7)}`,
              value: day.words,
            }))}
            labelEvery={5}
          />
        ) : null}

        {writing.monthly.length > 0 ? (
          <BarSeries
            title="Palavras por mês"
            caption={
              comparison === null
                ? undefined
                : comparison > 5
                  ? `Você escreveu ${comparison}% mais que no mês passado.`
                  : comparison < -5
                    ? `Você escreveu ${Math.abs(comparison)}% menos que no mês passado.`
                    : "Seu ritmo está parecido com o do mês passado."
            }
            points={writing.monthly.map((month) => ({ label: month.label, value: month.words }))}
            labelEvery={1}
          />
        ) : null}
      </div>

      {history && history.calendar.length > 0 ? (
        <div className="chart-card">
          <h3 className="chart-title">Histórico de escrita</h3>
          <p className="muted">
            {history.weekly.reduce((sum, week) => sum + week.notes, 0)} notas nas últimas{" "}
            {history.calendar.length} semanas
          </p>
          <div className="heatmap">
            {history.calendar.map((column, columnIndex) => (
              <div className="heat-col" key={columnIndex}>
                {column.map((cell, dayIndex) => (
                  <span
                    className={cell.key === null ? "heat-cell heat-cell--empty" : "heat-cell"}
                    key={dayIndex}
                    title={cell.key ? `${cell.key}: ${number(cell.words)} palavras` : ""}
                    style={
                      cell.key === null
                        ? undefined
                        : { background: heatColor(cell.words, history.max_daily) }
                    }
                  />
                ))}
              </div>
            ))}
          </div>
          <ul className="chip-list">
            <li className="chip">menos</li>
            {HEAT.map((color, level) => (
              <li className="chip chip--swatch" key={level} style={{ background: color }} />
            ))}
            <li className="chip">mais</li>
          </ul>
        </div>
      ) : null}

      <div className="chart-card">
        <h3 className="chart-title">Quando você escreve (dia × hora)</h3>
        <div className="hour-grid">
          <div className="hour-labels">
            {WEEKDAY_INITIALS.map((initial, index) => (
              <span key={index}>{initial}</span>
            ))}
          </div>
          <div className="hour-rows">
            {writing.weekday_hour.map((row, rowIndex) => (
              <div className="hour-row" key={rowIndex}>
                {row.map((value, columnIndex) => (
                  <span
                    className={value > 0 ? "hour-cell hour-cell--on" : "hour-cell"}
                    key={columnIndex}
                    title={`${number(value)} notas`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="hour-ticks" aria-hidden="true">
          {HOUR_LABELS.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      </div>

      <div className="chart-grid">
        <div className="chart-card">
          <h3 className="chart-title">Como você se sentiu</h3>
          {sentiment.analyzed === 0 ? (
            <p className="muted">Análise as notas para ver o tom desta janela.</p>
          ) : (
            <>
              <p>
                Tom {sentiment.average > 0.15 ? "positivo" : sentiment.average < -0.15 ? "negativo" : "neutro"}
              </p>
              <ul className="chip-list">
                <li className="chip">
                  <span className="tone tone--up" aria-hidden="true">↑</span> Positivas ·{" "}
                  {percentOf(sentiment.positive, sentiment.analyzed)}%
                </li>
                <li className="chip">
                  <span className="tone" aria-hidden="true">·</span> Neutras ·{" "}
                  {percentOf(sentiment.neutral, sentiment.analyzed)}%
                </li>
                <li className="chip">
                  <span className="tone tone--down" aria-hidden="true">↓</span> Negativas ·{" "}
                  {percentOf(sentiment.negative, sentiment.analyzed)}%
                </li>
              </ul>
              {sentiment.emotions && sentiment.emotions.length > 0 ? (
                <ul className="chip-list">
                  {sentiment.emotions.slice(0, 3).map((emotion) => (
                    <li className="chip" key={emotion.label}>
                      <span className={toneClass(emotion.tone)} aria-hidden="true">
                        {toneArrow(emotion.tone)}
                      </span>
                      {emotion.label} · {emotion.count}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="muted">
                {sentiment.analyzed} nota{sentiment.analyzed === 1 ? "" : "s"} analisada
                {sentiment.analyzed === 1 ? "" : "s"} nesta janela.
                {sentiment.source === "lexical" ? " Estimativa pelo texto, sem análise." : ""}
              </p>
            </>
          )}
        </div>

        <div className="chart-card">
          <h3 className="chart-title">Ritmo</h3>
          <p>
            Sequência atual {writing.current_streak} dia{writing.current_streak === 1 ? "" : "s"} · maior{" "}
            {writing.longest_streak}
          </p>
          <p>
            {writing.active_days} dia{writing.active_days === 1 ? "" : "s"} com nota ·{" "}
            {writing.average_notes_per_active_day} notas por dia ativo
          </p>
          <p className="muted">
            {writing.wrote_today ? "Você escreveu hoje." : "Ainda não escreveu hoje."}
            {writing.top_weekday && writing.top_hour
              ? ` Costuma escrever na ${writing.top_weekday.label}, pela ${writing.top_hour.label}.`
              : ""}
          </p>
        </div>
      </div>

      {voice ? (
        <div className="chart-card">
          <h3 className="chart-title">Sua voz</h3>
          <p>
            {voice.audio_minutes} min gravados, {voice.transcribed_minutes} transcritos
          </p>
          <ul className="chip-list">
            <li className="chip">Cobertura · {Math.round(voice.coverage * 100)}%</li>
            <li className="chip">Palavras/áudio · {voice.words_per_audio}</li>
            <li className="chip">Áudios · {voice.audio_count}</li>
            <li className="chip">Locais · {voice.origin_local}</li>
            <li className="chip">Servidor · {voice.origin_server}</li>
            <li className="chip">Texto da fala · {Math.round(voice.transcript_share * 100)}%</li>
          </ul>
        </div>
      ) : null}

      {topics && (topics.themes.length > 0 || topics.people.length > 0 || topics.places.length > 0) ? (
        <div className="chart-card">
          <h3 className="chart-title">Sobre o que você escreveu</h3>
          {topicRow("Temas", topics.themes)}
          {topicRow("Pessoas", topics.people)}
          {topicRow("Lugares", topics.places)}
        </div>
      ) : null}

      {images && images.count > 0 ? (
        <div className="chart-card">
          <h3 className="chart-title">Imagens</h3>
          <p>
            {images.count} {images.count === 1 ? "foto" : "fotos"} · {bytes(images.bytes_total)}
          </p>
          <ul className="chip-list">
            <li className="chip">Por nota · {images.per_note}</li>
            <li className="chip">Tamanho médio · {bytes(images.bytes_average)}</li>
            <li className="chip">Com imagem · {images.notes_with_image}</li>
          </ul>
          {images.notes_with_image_no_text > 0 ? (
            <p className="muted">
              {images.notes_with_image_no_text} nota
              {images.notes_with_image_no_text === 1 ? "" : "s"} com imagem e sem texto de apoio.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="chart-grid">
        {writing.top_words.length > 0 ? (
          <div className="chart-card">
            <h3 className="chart-title">Palavras mais usadas</h3>
            <ul className="chip-list">
              {writing.top_words.map((word) => (
                <li className="chip" key={word.label}>
                  {word.label} · {word.value}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {writing.longest_words.length > 0 ? (
          <div className="chart-card">
            <h3 className="chart-title">Palavras mais longas</h3>
            <ul className="chip-list">
              {writing.longest_words.map((word) => (
                <li className="chip" key={word.label}>
                  {word.label} · {word.value}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="chart-card">
        <h3 className="chart-title">Marcadores</h3>
        <ul className="chip-list">
          <li className="chip">Perguntas · {writing.questions}</li>
          <li className="chip">Exclamações · {writing.exclamations}</li>
          <li className="chip">Links · {writing.links}</li>
          <li className="chip">Imagens · {writing.images}</li>
          <li className="chip">Itens de lista · {writing.list_items}</li>
        </ul>
      </div>
    </>
  );
}
