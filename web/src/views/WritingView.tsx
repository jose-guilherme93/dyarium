import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Spinner } from "../components/Status";
import type { MetricsSnapshot } from "../types";

/**
 * Painel "Escrita": mostra as metricas que o app calcula offline. O celular
 * envia o documento pronto (contrato em docs/api.md); aqui so desenhamos, sem
 * recalcular nada, para os numeros baterem exatamente com o app.
 */

const WEEKDAY_INITIALS = ["D", "S", "T", "Q", "Q", "S", "S"];
const HOUR_LABELS = ["0h", "3h", "6h", "9h", "12h", "15h", "18h", "21h"];

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await api.getMetrics();
      const list = result.snapshots ?? [];
      setSnapshots(list);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao carregar as metricas");
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
        <div className="view-header">
          <h1>Escrita</h1>
        </div>
        <p className="muted">
          <Spinner /> Carregando...
        </p>
      </section>
    );
  }

  return (
    <section className="view">
      <div className="view-header">
        <h1>Escrita</h1>
        <button type="button" className="link-button" onClick={() => void load()}>
          Atualizar
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {!snapshot ? (
        <div className="empty-state">
          <p>Nenhuma metrica recebida ainda.</p>
          <p className="muted">
            Abra o app no aparelho com o servidor configurado: as metricas de escrita sao calculadas
            no proprio celular e enviadas para ca.
          </p>
        </div>
      ) : (
        <WritingBody
          snapshot={snapshot}
          devices={snapshots}
          onSelect={setSelected}
        />
      )}
    </section>
  );
}

function WritingBody({
  snapshot,
  devices,
  onSelect,
}: {
  snapshot: MetricsSnapshot;
  devices: MetricsSnapshot[];
  onSelect: (deviceId: string) => void;
}) {
  const writing = snapshot.writing;
  if (!writing) {
    return <p className="muted">O snapshot deste aparelho esta em uma versao que nao sei ler.</p>;
  }
  const history = snapshot.history;
  const comparison = writing.month_comparison_pct;
  const percent = Math.round(writing.consistency.rate * 100);
  const sentiment = writing.sentiment;

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
          <h3 className="chart-title">Insights</h3>
          <ul className="insight-list">
            {writing.insights.map((text) => (
              <li key={text}>{text}</li>
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
          <h3 className="chart-title">Humor dos textos</h3>
          {sentiment.analyzed === 0 ? (
            <p className="muted">Sem textos analisados ainda.</p>
          ) : (
            <>
              <p>
                Tom {sentiment.average > 0.15 ? "positivo" : sentiment.average < -0.15 ? "negativo" : "neutro"} (
                {sentiment.average.toFixed(2)})
              </p>
              <ul className="chip-list">
                <li className="chip">Positivos · {percentOf(sentiment.positive, sentiment.analyzed)}%</li>
                <li className="chip">Neutros · {percentOf(sentiment.neutral, sentiment.analyzed)}%</li>
                <li className="chip">Negativos · {percentOf(sentiment.negative, sentiment.analyzed)}%</li>
              </ul>
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
