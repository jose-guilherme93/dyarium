import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { ArrowUpRightIcon, ChevronIcon, CloseIcon, PlusIcon, WaveIcon } from "../components/icons";
import { ListSkeleton } from "../components/Skeleton";
import { useToast } from "../components/Toasts";
import { ALL_NOTEBOOKS } from "../lib/notebooks";
import type { Entry, Notebook } from "../types";

interface CalendarViewProps {
  refreshKey: number;
  /** Caderno do escopo (ou ALL_NOTEBOOKS para a biblioteca inteira). */
  notebookId: string;
  notebooks: Notebook[];
  /** Abre a nota no editor de sempre. */
  onOpenNote: (id: string) => void;
  /** Cria a nota de hoje e abre no editor. Só o dia atual aceita escrita. */
  onCreateNote: (title: string) => Promise<void> | void;
}

const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

const WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

const WEEKDAY_NAMES = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

/** Data da nota: a do evento quando existe, senao a de criacao. */
function noteDate(entry: Entry): string {
  return entry.recorded_at ?? entry.created_at;
}

/** Chave do dia no fuso do navegador ("2026-11-13"), a mesma que o usuario ve. */
function dayKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function timeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function todayKey(): string {
  return dayKey(new Date().toISOString());
}

function noteTitle(entry: Entry): string {
  const title = (entry.title ?? "").trim();
  if (title) return title;
  const preview = (entry.preview ?? "").trim();
  if (preview) return preview.split("\n")[0].trim();
  return "Sem título";
}

function isAudio(entry: Entry): boolean {
  return entry.source !== "text" && entry.duration_seconds > 0;
}

/**
 * Calendario das notas: cada dia mostra as notas daquele dia e o painel ao lado
 * abre o dia escolhido, escreve uma nota nova e lembra o mesmo dia nos anos
 * anteriores. A data vem de recorded_at (o dia do evento), com created_at como
 * reserva; a grade usa o fuso do navegador, nunca UTC.
 */
export function CalendarView({
  refreshKey,
  notebookId,
  notebooks,
  onOpenNote,
  onCreateNote,
}: CalendarViewProps) {
  const { notify } = useToast();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selected, setSelected] = useState(todayKey);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const allNotebooks = notebookId === ALL_NOTEBOOKS;
  const filters = useMemo(
    () =>
      allNotebooks
        ? { limit: 1000, exclude_books: true }
        : { limit: 1000, notebook_id: notebookId },
    [allNotebooks, notebookId],
  );

  const load = useCallback(async () => {
    const cached = await api.listEntriesCached(filters);
    if (cached) {
      setEntries(cached.entries ?? []);
      setLoaded(true);
    }
    try {
      const result = await api.listAllEntries(filters);
      setEntries(result.entries ?? []);
      setError("");
    } catch (err) {
      if (!cached) {
        setError(err instanceof Error ? err.message : "falha ao carregar");
      }
    } finally {
      setLoaded(true);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // Trocar de caderno recomeca no dia de hoje e limpa a carga anterior: o dia
  // escolhido num escopo nao precisa existir no outro, e nota de um caderno nao
  // pode aparecer como se fosse do outro.
  useEffect(() => {
    const now = new Date();
    setEntries([]);
    setLoaded(false);
    setError("");
    setCursor({ year: now.getFullYear(), month: now.getMonth() });
    setSelected(todayKey());
    setSheetOpen(false);
    setComposing(false);
    setDraft("");
  }, [notebookId]);

  const notebookById = useMemo(
    () => new Map(notebooks.map((notebook) => [notebook.id, notebook])),
    [notebooks],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const entry of entries) {
      if (entry.archived) continue;
      const key = dayKey(noteDate(entry));
      if (!key) continue;
      const list = map.get(key);
      if (list) list.push(entry);
      else map.set(key, [entry]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => noteDate(a).localeCompare(noteDate(b)));
    }
    return map;
  }, [entries]);

  const monthDays = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1);
    const offset = (first.getDay() + 6) % 7;
    const total = new Date(cursor.year, cursor.month + 1, 0).getDate();
    const weeks = Math.ceil((offset + total) / 7);
    return Array.from({ length: weeks * 7 }, (_, index) => {
      const date = new Date(cursor.year, cursor.month, index - offset + 1);
      const key = dayKey(date.toISOString());
      return {
        key,
        day: date.getDate(),
        out: date.getMonth() !== cursor.month,
        weekend: date.getDay() === 0 || date.getDay() === 6,
      };
    });
  }, [cursor]);

  const monthCount = useMemo(() => {
    let count = 0;
    const prefix = `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}`;
    for (const [key, list] of byDay) {
      if (key.startsWith(prefix)) count += list.length;
    }
    return count;
  }, [byDay, cursor]);

  const dayNotes = byDay.get(selected) ?? [];
  const selectedDate = new Date(`${selected}T12:00:00`);
  const selectedYear = Number(selected.slice(0, 4));

  const otherYears = useMemo(() => {
    const monthDay = selected.slice(5);
    const groups = new Map<string, Entry[]>();
    for (const entry of entries) {
      if (entry.archived) continue;
      const key = dayKey(noteDate(entry));
      if (!key || key.slice(5) !== monthDay || key.slice(0, 4) === selected.slice(0, 4)) continue;
      const year = key.slice(0, 4);
      const list = groups.get(year);
      if (list) list.push(entry);
      else groups.set(year, [entry]);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => noteDate(a).localeCompare(noteDate(b)));
    }
    return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [entries, selected]);

  // Trocar de mes leva o dia escolhido junto (mesmo dia, limitado ao ultimo do
  // mes): o painel nunca mostra um dia que nao esta na grade.
  const shiftMonth = (delta: number) => {
    const date = new Date(cursor.year, cursor.month + delta, 1);
    const year = date.getFullYear();
    const month = date.getMonth();
    const last = new Date(year, month + 1, 0).getDate();
    const day = Math.min(Number(selected.slice(8, 10)) || 1, last);
    setCursor({ year, month });
    setSelected(`${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
    setComposing(false);
    setDraft("");
  };

  const selectDay = (key: string) => {
    setSelected(key);
    setComposing(false);
    setDraft("");
    setSheetOpen(true);
    if (key === todayKey()) {
      setComposing(true);
    }
  };

  const goToday = () => {
    const now = new Date();
    setCursor({ year: now.getFullYear(), month: now.getMonth() });
    setSelected(todayKey());
    setDraft("");
    setComposing(true);
    setSheetOpen(true);
  };

  useEffect(() => {
    if (composing) composerRef.current?.focus();
  }, [composing]);

  // Nota nasce sempre com a data de geracao dela: escrever no calendario so
  // vale para hoje. Dias anteriores podem vir de importacao ou de audio.
  const today = todayKey();
  const canWrite = selected === today;

  const submit = async () => {
    const title = draft.trim();
    if (!title || saving || !canWrite) return;
    setSaving(true);
    try {
      await onCreateNote(title);
      setDraft("");
      setComposing(false);
    } catch {
      notify("Não foi possível criar a nota.", "error");
    } finally {
      setSaving(false);
    }
  };

  const notebookName = (entry: Entry) =>
    notebookById.get(entry.notebook_id ?? "")?.name ?? "";
  const notebookColor = (entry: Entry) =>
    notebookById.get(entry.notebook_id ?? "")?.color || "var(--color-muted)";

  const openNote = (entry: Entry) => onOpenNote(entry.id);

  if (!loaded && entries.length === 0) {
    return (
      <div className="calendar-page">
        <div className="calendar-loading">
          <ListSkeleton rows={4} />
        </div>
      </div>
    );
  }

  return (
    <div className="calendar-page">
      {error && <p className="error calendar-error">{error}</p>}
      <div className={sheetOpen ? "calendar calendar--sheet" : "calendar"}>
        <section className="calendar-main" aria-label="Calendário das notas">
          <header className="calendar-head">
            <h1 className="calendar-month">
              {MONTHS[cursor.month]} <span>{cursor.year}</span>
            </h1>
            <span className="calendar-count">
              {monthCount} {monthCount === 1 ? "nota" : "notas"}
            </span>
            <div className="calendar-nav">
              <button
                type="button"
                className="calendar-nav-button"
                onClick={() => shiftMonth(-1)}
                aria-label="Mês anterior"
                title="Mês anterior"
              >
                <ChevronIcon size={14} />
              </button>
              <button
                type="button"
                className="calendar-nav-button"
                onClick={() => shiftMonth(1)}
                aria-label="Próximo mês"
                title="Próximo mês"
              >
                <ChevronIcon size={14} />
              </button>
              <button type="button" className="calendar-today" onClick={goToday}>
                hoje
              </button>
            </div>
          </header>

          <div className="calendar-weekdays" aria-hidden="true">
            {WEEKDAYS.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>

          <div className="calendar-grid">
            {monthDays.map((cell) => {
              const list = cell.out ? [] : (byDay.get(cell.key) ?? []);
              const isToday = cell.key === todayKey();
              const isSelected = cell.key === selected;
              const extra = list.length - 3;
              const classes = ["calendar-cell"];
              if (cell.out) classes.push("calendar-cell--out");
              else if (cell.weekend) classes.push("calendar-cell--weekend");
              if (isToday) classes.push("calendar-cell--today");
              if (isSelected) classes.push("calendar-cell--selected");
              return (
                <button
                  key={cell.key}
                  type="button"
                  className={classes.join(" ")}
                  data-day={cell.key}
                  disabled={cell.out}
                  aria-pressed={cell.out ? undefined : isSelected}
                  aria-label={`${cell.day} de ${MONTHS[new Date(cell.key + "T12:00:00").getMonth()]}${
                    cell.out ? "" : `, ${list.length} ${list.length === 1 ? "nota" : "notas"}`
                  }`}
                  onClick={() => selectDay(cell.key)}
                >
                  <span className="calendar-daynum">
                    <span className={isToday ? "calendar-today-dot" : undefined}>
                      {cell.day}
                    </span>
                    {list.length > 0 && <span className="calendar-daycount">{list.length}</span>}
                  </span>
                  {list.slice(0, 3).map((entry) => (
                    <span key={entry.id} className="calendar-line">
                      <i style={{ background: notebookColor(entry) }} />
                      <span>{noteTitle(entry)}</span>
                    </span>
                  ))}
                  {extra > 0 && <span className="calendar-more">+{extra}</span>}
                  {list.length > 0 && (
                    <span className="calendar-dots" aria-hidden="true">
                      {list.slice(0, 5).map((entry) => (
                        <i key={entry.id} style={{ background: notebookColor(entry) }} />
                      ))}
                      {list.length > 5 && (
                        <span className="calendar-dots-more">+{list.length - 5}</span>
                      )}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <button
          type="button"
          className={sheetOpen ? "calendar-backdrop calendar-backdrop--on" : "calendar-backdrop"}
          aria-label="Fechar dia"
          onClick={() => setSheetOpen(false)}
        />

        <aside className="calendar-panel" aria-label="Dia escolhido">
          <header className="calendar-panel-head">
            <div>
              <div className="calendar-panel-weekday">
                {WEEKDAY_NAMES[selectedDate.getDay()]}
              </div>
              <div className="calendar-panel-date">
                {selectedDate.getDate()} de {MONTHS[selectedDate.getMonth()]}
                {selectedYear !== new Date().getFullYear() ? ` de ${selectedYear}` : ""}
              </div>
            </div>
            <span className="calendar-panel-count">
              {dayNotes.length} {dayNotes.length === 1 ? "nota" : "notas"}
            </span>
            <button
              type="button"
              className="calendar-panel-close"
              onClick={() => setSheetOpen(false)}
              aria-label="Fechar dia"
            >
              <CloseIcon size={14} />
            </button>
          </header>

          <div className="calendar-panel-scroll">
            <div className="calendar-notes">
              {dayNotes.length === 0 && <p className="calendar-empty">—</p>}
              {dayNotes.map((entry) => {
                const title = noteTitle(entry);
                return (
                  <div key={entry.id} className="calendar-note">
                    <button
                      type="button"
                      className="calendar-note-main"
                      onClick={() => openNote(entry)}
                    >
                      <span className="calendar-note-time">{timeLabel(noteDate(entry))}</span>
                      <span className="calendar-note-text">
                        <span className="calendar-note-title">{title}</span>
                        <span className="calendar-note-meta">
                          <i style={{ background: notebookColor(entry) }} />
                          {notebookName(entry)}
                          {isAudio(entry) ? <WaveIcon size={10} /> : null}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="calendar-note-open"
                      onClick={() => openNote(entry)}
                      aria-label={`Abrir nota: ${title}`}
                      title="Abrir nota"
                    >
                      <ArrowUpRightIcon size={13} />
                    </button>
                  </div>
                );
              })}
            </div>

            {canWrite && composing ? (
              <div className="calendar-compose">
                <textarea
                  ref={composerRef}
                  rows={2}
                  value={draft}
                  placeholder="escrever"
                  aria-label="Escrever nota neste dia"
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void submit();
                    }
                    if (event.key === "Escape") {
                      setComposing(false);
                      setDraft("");
                    }
                  }}
                />
              </div>
            ) : canWrite ? (
              <button
                type="button"
                className="calendar-compose-cta"
                onClick={() => setComposing(true)}
              >
                <PlusIcon size={12} />
                escrever
              </button>
            ) : null}

            {otherYears.length > 0 && (
              <div className="calendar-years">
                <h2>outros anos</h2>
                <div className="calendar-timeline">
                  {otherYears.map(([year, list]) => (
                    <div key={year} className="calendar-timeline-year">
                      <div className="calendar-timeline-label">
                        <span>{year}</span>
                        <span className="calendar-timeline-count">{list.length}</span>
                      </div>
                      {list.map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          className="calendar-timeline-note"
                          onClick={() => openNote(entry)}
                        >
                          <span className="calendar-timeline-time">
                            {timeLabel(noteDate(entry))}
                          </span>
                          <span className="calendar-timeline-title">{noteTitle(entry)}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

export default CalendarView;
