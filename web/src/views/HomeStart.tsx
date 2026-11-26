import { useEffect, useMemo, useState } from "react";

import { greetingForHour } from "../../../mobile/src/core/greeting";
import { api } from "../api";
import type { MetricsSnapshot } from "../types";
import { Button } from "../ui/Button";
import "./HomeStart.css";

export interface HomeStartProps {
  /** Notas que este cliente ja tem na lista, quando a tela sabe contar. */
  noteCount?: number;
  onNewNote?(): void;
  onOpenAnalysis(): void;
}

/**
 * Inicio do web, quando nenhuma nota esta aberta.
 *
 * A saudacao vem da hora do aparelho. Os numeros vem do snapshot que o proprio
 * cliente calcula sobre as notas que tem (`api.getMetrics`), sem LLM: no maximo
 * duas frases de resumo e quatro numeros. As importacoes nao ficam aqui; elas
 * vivem no trilho esquerdo.
 */
export function HomeStart({ noteCount, onOpenAnalysis }: HomeStartProps) {
  const [snapshot, setSnapshot] = useState<MetricsSnapshot | null>(null);

  useEffect(() => {
    let alive = true;
    void api
      .getMetrics()
      .then((result) => {
        if (alive) setSnapshot(result.snapshots[0] ?? null);
      })
      .catch(() => {
        if (alive) setSnapshot(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const greeting = greetingForHour(new Date().getHours());
  const today = useMemo(
    () =>
      new Intl.DateTimeFormat("pt-BR", {
        weekday: "short",
        day: "numeric",
        month: "short",
      }).format(new Date()),
    [],
  );

  const view = useMemo(() => metricsView(snapshot, noteCount), [snapshot, noteCount]);

  return (
    <section className="hs" aria-label="início">
      <div className="hs__block">
        <h1 className="dy-greeting hs__greet">{greeting}</h1>
        <p className="dy-mono hs__pulse">
          <span>{today}</span>
          {view.noteLabel ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{view.noteLabel}</span>
            </>
          ) : null}
        </p>
        {view.summary ? <p className="dy-body hs__summary">{view.summary}</p> : null}
        {view.facts.length > 0 ? (
          <div className="hs__facts">
            {view.facts.map((fact) => (
              <span key={fact.label} className="hs__fact">
                <span className="dy-mono hs__fact-label">{fact.label}</span>{" "}
                <span className="dy-body hs__fact-value">{fact.value}</span>
              </span>
            ))}
          </div>
        ) : null}
        <div className="hs__actions">
          <Button variant="secondary" onClick={onOpenAnalysis}>
            análise
          </Button>
        </div>
      </div>
    </section>
  );
}

interface Fact {
  label: string;
  value: string;
}

interface HomeView {
  noteLabel: string;
  summary: string | null;
  facts: Fact[];
}

const number = new Intl.NumberFormat("pt-BR");

/** Traduz o snapshot para, no maximo, duas frases e quatro numeros. */
export function metricsView(snapshot: MetricsSnapshot | null, noteCount?: number): HomeView {
  const localCount =
    noteCount === undefined
      ? ""
      : `${number.format(noteCount)} ${noteCount === 1 ? "nota" : "notas"}`;
  if (!snapshot) {
    return { noteLabel: localCount, summary: null, facts: [] };
  }

  const window = snapshot.schema === 2 ? snapshot.windows["30d"] : null;
  const writing = window ? window.writing : snapshot.schema === 1 ? snapshot.writing : null;
  const summary = window ? window.summary.filter((item) => item.trim() !== "").slice(0, 2) : [];
  const themes = window?.topics.themes ?? [];
  const strength = snapshot.schema === 2 ? snapshot.streak.current : 0;

  const facts: Fact[] = [];
  if (writing) {
    facts.push({
      label: "notas",
      value: number.format(writing.with_text),
    });
  }
  if (writing?.top_words[0]) {
    facts.push({ label: "palavra", value: writing.top_words[0].label });
  }
  if (themes[0]) {
    facts.push({ label: "assunto", value: themes[0].label });
  }
  if (writing && writing.words > 0) {
    facts.push({ label: "palavras", value: number.format(writing.words) });
  }
  if (strength > 1) {
    facts.push({ label: "sequência", value: `${strength} dias` });
  }

  return {
    noteLabel: writing ? `${number.format(writing.with_text)} notas no mês` : localCount,
    summary: summary.length > 0 ? summary.join(" ") : null,
    facts: facts.slice(0, 4),
  };
}
