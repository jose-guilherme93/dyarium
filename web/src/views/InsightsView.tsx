import { useEffect, useRef, useState, type KeyboardEvent } from "react";
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
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (focus) {
      setTab(focus.kind);
      setSelected(focus.name);
    }
  }, [focus]);

  const selectTab = (id: Tab) => {
    setTab(id);
    setSelected(null);
  };

  // Arrow keys, Home and End move between tabs, per the ARIA tabs pattern.
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = TABS.length - 1;
    let next: number;
    if (event.key === "ArrowRight") {
      next = index === last ? 0 : index + 1;
    } else if (event.key === "ArrowLeft") {
      next = index === 0 ? last : index - 1;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = last;
    } else {
      return;
    }
    event.preventDefault();
    selectTab(TABS[next].id);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="insights-view">
      <div className="tabs" role="tablist" aria-label="Categorias de insights">
        {TABS.map((item, index) => (
          <button
            key={item.id}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`insights-tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`insights-tabpanel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            className={tab === item.id ? "tab tab--active" : "tab"}
            onClick={() => selectTab(item.id)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`insights-tabpanel-${tab}`}
        aria-labelledby={`insights-tab-${tab}`}
        tabIndex={0}
        className="insights-panel-content"
      >
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
    </div>
  );
}

export default InsightsView;
