import { useEffect, useState } from "react";
import type { EntityKind } from "../types";
import { EntitiesView } from "./EntitiesView";
import { MoodView } from "./MoodView";

type Tab = EntityKind | "mood";

interface InsightsViewProps {
  refreshKey: number;
  onOpen: (id: string) => void;
  focus: { kind: EntityKind; name: string } | null;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "person", label: "Pessoas" },
  { id: "place", label: "Lugares" },
  { id: "theme", label: "Temas" },
  { id: "mood", label: "Humor" },
];

// InsightsView aggregates what the AI extracted across notes.
export function InsightsView({ refreshKey, onOpen, focus }: InsightsViewProps) {
  const [tab, setTab] = useState<Tab>(focus?.kind ?? "person");
  const [selected, setSelected] = useState<string | null>(focus?.name ?? null);

  useEffect(() => {
    if (focus) {
      setTab(focus.kind);
      setSelected(focus.name);
    }
  }, [focus]);

  return (
    <div className="insights-view">
      <header className="page-head">
        <div>
          <h1>Insights</h1>
          <p>Pessoas, lugares, temas e humor que a análise encontrou nas suas notas.</p>
        </div>
      </header>
      <div className="segmented" role="tablist" aria-label="Tipo de insight">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? "segmented-option segmented-option--on" : "segmented-option"}
            onClick={() => {
              setTab(item.id);
              setSelected(null);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === "mood" ? (
        <MoodView refreshKey={refreshKey} />
      ) : (
        <EntitiesView
          kind={tab}
          title=""
          selected={selected}
          onSelect={setSelected}
          onOpen={onOpen}
          refreshKey={refreshKey}
        />
      )}
    </div>
  );
}

export default InsightsView;
