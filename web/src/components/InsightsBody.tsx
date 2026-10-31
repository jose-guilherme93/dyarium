import { formatDuration } from "../lib/format";
import type { Analysis, EntityKind } from "../types";
import { NoteRelations } from "./NoteRelations";

interface InsightsBodyProps {
  analysis: Analysis;
  onOpenEntity: (kind: EntityKind, name: string) => void;
  /** Ligado enquanto o worker da aba ainda esta compondo o documento. */
  live?: boolean;
}

function sentimentText(label?: string): string {
  switch (label) {
    case "positivo":
      return "Positivo";
    case "negativo":
      return "Negativo";
    case "neutro":
      return "Neutro";
    default:
      return "Sem rotulo";
  }
}

function emotionPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value <= 1 ? value * 100 : value)));
}

function ListBlock({
  title,
  items,
}: {
  title: string;
  items: string[] | null | undefined;
}) {
  const values = (items ?? []).map((item) => item.trim()).filter(Boolean);
  if (values.length === 0) return null;
  return (
    <div className="analysis-block stagger-in">
      <h4>{title}</h4>
      <ul className="insight-list stagger-in">
        {values.map((item, index) => (
          <li key={`${item}-${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Corpo da ficha de insights. Recebe o documento inteiro ou o parcial do
 * worker: a diferenca e so quantos blocos chegaram, o desenho e o mesmo.
 */
export function InsightsBody({ analysis, onOpenEntity, live = false }: InsightsBodyProps) {
  const emotions =
    analysis.emotions_detail && analysis.emotions_detail.length > 0
      ? analysis.emotions_detail
      : Object.entries(analysis.emotions ?? {}).map(([name, intensity]) => ({ name, intensity }));

  const themes = analysis.themes ?? [];
  // Analises antigas so trazem os nomes; completar a contagem evita sumir com
  // a pessoa do grafo e dos chips.
  const people =
    analysis.people_detail && analysis.people_detail.length > 0
      ? analysis.people_detail
      : (analysis.people ?? []).map((name) => ({
          name,
          count: 1,
          relation: "",
          sentiment: 0,
        }));
  const places =
    analysis.places_detail && analysis.places_detail.length > 0
      ? analysis.places_detail
      : (analysis.places ?? []).map((name) => ({ name, count: 1 }));
  const moments = analysis.key_moments ?? [];
  const withDetails: Analysis =
    people !== analysis.people_detail || places !== analysis.places_detail
      ? { ...analysis, people_detail: people, places_detail: places }
      : analysis;

  return (
    <div className={live ? "insights insights--live" : "insights"}>
      <NoteRelations analysis={withDetails} onOpenEntity={onOpenEntity} />

      <p>
        Sentimento: <strong>{sentimentText(analysis.sentiment_label)}</strong>{" "}
        <span className="muted">({Number(analysis.sentiment ?? 0).toFixed(2)})</span>
      </p>

      {typeof analysis.comprehension === "number" && analysis.comprehension >= 0 && (
        <p
          className="insight-comprehension"
          title={
            analysis.comprehension_source === "review"
              ? `Compreensão lógica estimada do texto revisado (0 a 100); ${analysis.revised_segments ?? 0} trechos melhorados pela IA.`
              : "Compreensão lógica estimada pelo modelo sobre o texto lido (0 a 100); a transcrição não foi revisada."
          }
        >
          Compreensão <strong>{analysis.comprehension}/100</strong>
          {analysis.comprehension_source !== "review" && (
            <span className="muted"> · sem revisão</span>
          )}
        </p>
      )}

      {((analysis.stutter_rate ?? 0) > 0 || (analysis.hesitation_rate ?? 0) > 0) && (
        <p
          className="muted insight-disfluency"
          title="Ocorrências por 100 palavras do texto cru do áudio."
        >
          Gagueira {Number(analysis.stutter_rate ?? 0).toFixed(1)} · Hesitação{" "}
          {Number(analysis.hesitation_rate ?? 0).toFixed(1)}
        </p>
      )}

      {(analysis.reading || analysis.summary) && (
        <p key={analysis.reading || analysis.summary} className="insight-reading insight-fade">
          {analysis.reading || analysis.summary}
        </p>
      )}

      {analysis.origin === "browser" && analysis.device_name && (
        <p className="hint insight-device" title="Aparelho que processou esta análise.">
          {analysis.device_name}
        </p>
      )}

      {analysis.sections && analysis.sections.length > 1 && (
        <div className="analysis-block stagger-in">
          <h4>Seções</h4>
          {analysis.sections.map((section, index) => (
            <details key={`${section.heading}-${index}`} className="insight-section">
              <summary>
                {section.heading || "Nota"}
                <span className="muted">{sentimentText(section.sentiment?.label ?? "")}</span>
              </summary>
              {(section.reading || section.summary) && (
                <p>{section.reading || section.summary}</p>
              )}
            </details>
          ))}
        </div>
      )}

      {emotions.length > 0 && (
        <div className="analysis-block stagger-in">
          <h4>Emoções</h4>
          <ul className="chips stagger-in">
            {emotions
              .slice()
              .sort((a, b) => b.intensity - a.intensity)
              .slice(0, 8)
              .map((emotion) => (
                <li key={emotion.name}>
                  {emotion.name}{" "}
                  <span className="muted">{emotionPercent(emotion.intensity)}%</span>
                </li>
              ))}
          </ul>
        </div>
      )}

      {themes.length > 0 && (
        <div className="analysis-block stagger-in">
          <h4>Temas</h4>
          <ul className="chips stagger-in">
            {themes.map((theme) => (
              <li key={theme.name}>
                <button
                  type="button"
                  className="chip-button"
                  onClick={() => onOpenEntity("theme", theme.name)}
                >
                  {theme.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {people.length > 0 && (
        <div className="analysis-block stagger-in">
          <h4>Pessoas</h4>
          <ul className="chips stagger-in">
            {people.map((person) => (
              <li key={person.name}>
                <button
                  type="button"
                  className="chip-button"
                  onClick={() => onOpenEntity("person", person.name)}
                >
                  {person.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {places.length > 0 && (
        <div className="analysis-block stagger-in">
          <h4>Lugares</h4>
          <ul className="chips stagger-in">
            {places.map((place) => (
              <li key={place.name}>
                <button
                  type="button"
                  className="chip-button"
                  onClick={() => onOpenEntity("place", place.name)}
                >
                  {place.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ListBlock title="Eventos" items={analysis.events} />
      <ListBlock title="Decisões" items={analysis.decisions} />
      <ListBlock title="Tarefas" items={analysis.tasks} />
      <ListBlock title="Ideias" items={analysis.ideas} />
      <ListBlock title="Epifanias" items={analysis.epiphanies} />

      {moments.length > 0 && (
        <div className="analysis-block stagger-in">
          <h4>Momentos</h4>
          <ul className="moments stagger-in">
            {moments.map((moment, index) => (
              <li key={`${moment.start_ms}-${index}`}>
                <span className="timestamp">{formatDuration(moment.start_ms / 1000)}</span>
                {moment.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {analysis.coverage?.partial && (
        <p className="hint insight-coverage">
          parcial · {analysis.coverage.blocks_read}/{analysis.coverage.blocks_total} blocos
        </p>
      )}
    </div>
  );
}
