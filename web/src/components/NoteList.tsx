import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { api, uploadFile } from "../api";
import { dayKey, dayLabel, formatDuration } from "../lib/format";
import type { Entry } from "../types";
import { Recorder } from "./Recorder";
import { statusLabel } from "./Status";
import { PlusIcon, SearchIcon } from "./icons";

interface NoteListProps {
  refreshKey: number;
  activeId: string | null;
  onOpen: (id: string) => void;
  onChanged: () => void;
  onCreateText: () => void;
}

interface Group {
  key: string;
  label: string;
  items: Entry[];
}

// NoteList is the notes column: search, capture and the grouped note list.
export function NoteList({ refreshKey, activeId, onOpen, onChanged, onCreateText }: NoteListProps) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.listEntries();
      setEntries(result.entries ?? []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao carregar");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setUploading(true);
    setError("");
    try {
      await uploadFile(file);
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha no envio");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  const term = query.trim().toLowerCase();
  const filtered = term
    ? entries.filter((entry) => `${entry.title} ${entry.original_filename}`.toLowerCase().includes(term))
    : entries;

  const groups: Group[] = [];
  for (const entry of filtered) {
    const when = entry.recorded_at ?? entry.created_at;
    const key = dayKey(when);
    let group = groups.find((item) => item.key === key);
    if (!group) {
      group = { key, label: dayLabel(when), items: [] };
      groups.push(group);
    }
    group.items.push(entry);
  }

  return (
    <div className="list">
      <div className="list-head">
        <label className="list-search">
          <SearchIcon size={16} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar notas"
            aria-label="Buscar notas"
          />
        </label>
        <div className="list-actions">
          <Recorder onUploaded={() => void load().then(onChanged)} />
          <button type="button" className="icon-button" onClick={() => inputRef.current?.click()} aria-label="Enviar audio" disabled={uploading}>
            <PlusIcon size={16} />
          </button>
          <button type="button" className="new-note" onClick={onCreateText}>
            Nova nota
          </button>
        </div>
      </div>

      {error && <p className="error list-error">{error}</p>}
      {uploading && <p className="muted list-error">Enviando audio...</p>}

      <div className="list-scroll">
        {filtered.length === 0 ? (
          <div className="empty-state">
            <p>Nenhuma nota ainda.</p>
            <p>Grave um audio ou crie uma nota escrita.</p>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.key} className="list-group">
              <div className="list-group-label">{group.label}</div>
              <ul>
                {group.items.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className={entry.id === activeId ? "note-item note-item--active" : "note-item"}
                      onClick={() => onOpen(entry.id)}
                    >
                      <span className="note-item-title">{entry.title || entry.original_filename || "Nota"}</span>
                      <span className="note-item-meta">
                        {entry.duration_seconds > 0 ? `${formatDuration(entry.duration_seconds)} · ` : ""}
                        {statusLabel(entry.status)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.wav,.mp3,.m4a,.aac,.adts,.ogg,.oga,.opus,.flac,.webm"
        hidden
        onChange={handleFile}
      />
    </div>
  );
}

export default NoteList;
