import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Entry, Link } from "../types";
import { TrashIcon } from "./icons";

interface LinksPanelProps {
  entryId: string;
  onOpenEntry: (id: string) => void;
}

// LinksPanel manages the links of a note: other notes or external URLs.
export function LinksPanel({ entryId, onOpenEntry }: LinksPanelProps) {
  const [links, setLinks] = useState<Link[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [target, setTarget] = useState("");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [linksRes, entriesRes] = await Promise.all([api.listLinks(entryId), api.listEntries()]);
      setLinks(linksRes.links ?? []);
      setEntries((entriesRes.entries ?? []).filter((entry) => entry.id !== entryId));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao carregar links");
    }
  }, [entryId]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async (body: { to_entry_id?: string; url?: string; label?: string }) => {
    setBusy(true);
    setError("");
    try {
      await api.createLink(entryId, body);
      setTarget("");
      setUrl("");
      setLabel("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao criar o link");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.deleteLink(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao remover");
    }
  };

  const trimmedLabel = label.trim();
  const addInternal = () => {
    if (!target) {
      return;
    }
    void add({ to_entry_id: target, label: trimmedLabel || undefined });
  };
  const addExternal = () => {
    const value = url.trim();
    if (!value) {
      return;
    }
    void add({ url: value, label: trimmedLabel || undefined });
  };

  return (
    <div className="links">
      {links.length > 0 && (
        <ul className="link-list">
          {links.map((link) => (
            <li key={link.id} className="link-item">
              {link.to_entry_id ? (
                <button type="button" className="link-target" onClick={() => onOpenEntry(link.to_entry_id)}>
                  {link.label || link.title || "Nota vinculada"}
                </button>
              ) : (
                <a className="link-target" href={link.url} target="_blank" rel="noreferrer">
                  {link.label || link.url}
                </a>
              )}
              <button
                type="button"
                className="link-remove"
                onClick={() => void remove(link.id)}
                aria-label="Remover link"
              >
                <TrashIcon size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="link-form">
        <select
          className="link-select"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          aria-label="Vincular a uma nota"
        >
          <option value="">Vincular a uma nota...</option>
          {entries.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.title || entry.original_filename || entry.id}
            </option>
          ))}
        </select>
        <button type="button" onClick={addInternal} disabled={busy || target === ""}>
          Vincular
        </button>
      </div>

      <div className="link-form">
        <input
          type="url"
          className="link-url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://..."
          aria-label="URL externa"
        />
        <input
          type="text"
          className="link-label"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Rotulo (opcional)"
          aria-label="Rotulo do link"
        />
        <button type="button" onClick={addExternal} disabled={busy || url.trim() === ""}>
          Adicionar
        </button>
      </div>

      {error && <p className="error">{error}</p>}
    </div>
  );
}

export default LinksPanel;
