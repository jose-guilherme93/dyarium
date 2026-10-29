import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { tagColor } from "../lib/tags";
import { ListSkeleton } from "./Skeleton";
import { useEscape } from "../lib/useEscape";
import type { Tag } from "../types";

interface TagManagerProps {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}

/** Gerenciador do banco de tags: renomear (mesclando se ja existir) e excluir. */
export function TagManager({ open, onClose, onChanged }: TagManagerProps) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [editing, setEditing] = useState<Tag | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.listTags();
      setTags(result.tags ?? []);
      setError("");
    } catch {
      setError("Sem conexão com o servidor.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEscape(open, onClose);

  if (!open) return null;

  const save = async (merge: boolean) => {
    if (!editing) return;
    const next = name.trim();
    if (!next) return;
    try {
      await api.updateTag(editing.id, { name: next });
      setEditing(null);
      await load();
      onChanged();
    } catch {
      setError("Não foi possível renomear a tag.");
    }
    if (merge) {
      // A mescla ja aconteceu no servidor.
      setError("");
    }
  };

  const requestSave = () => {
    if (!editing) return;
    const next = name.trim();
    if (!next) return;
    const duplicate = tags.find(
      (tag) => tag.id !== editing.id && tag.name.toLowerCase() === next.toLowerCase(),
    );
    if (duplicate) {
      const ok = window.confirm(
        `“${duplicate.name}” já existe. Mesclar as duas? As notas serão movidas para ela.`,
      );
      if (!ok) return;
      void save(true);
      return;
    }
    void save(false);
  };

  const remove = async (tag: Tag) => {
    if (!window.confirm(`Excluir “${tag.name}”? Ela sai de ${tag.entry_count} nota(s).`)) return;
    try {
      await api.deleteTag(tag.id);
      await load();
      onChanged();
    } catch {
      setError("Não foi possível excluir a tag.");
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal-card tag-manager"
        role="dialog"
        aria-modal="true"
        aria-label="Gerenciar tags"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="tag-manager-head">
          <h2 className="modal-title">Tags</h2>
          <button type="button" className="button button--ghost" onClick={onClose}>
            Fechar
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {loading && tags.length === 0 && <ListSkeleton rows={4} compact />}
        <ul className="tag-manager-list stagger-in">
          {tags.map((tag) => (
            <li key={tag.id} className="tag-manager-row">
              <span className="tag-manager-dot" style={{ backgroundColor: tagColor(tag.name, tag.color) }} />
              {editing?.id === tag.id ? (
                <input
                  className="tag-manager-input"
                  value={name}
                  autoFocus
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") requestSave();
                    if (event.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <span className="tag-manager-name">{tag.name}</span>
              )}
              <span className="tag-manager-count">{tag.entry_count}</span>
              {editing?.id === tag.id ? (
                <>
                  <button type="button" className="button button--small" onClick={requestSave}>
                    Salvar
                  </button>
                  <button
                    type="button"
                    className="button button--ghost button--small"
                    onClick={() => setEditing(null)}
                  >
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="button button--ghost button--small"
                    onClick={() => {
                      setEditing(tag);
                      setName(tag.name);
                    }}
                  >
                    Renomear
                  </button>
                  <button
                    type="button"
                    className="button button--danger button--small"
                    onClick={() => void remove(tag)}
                  >
                    Excluir
                  </button>
                </>
              )}
            </li>
          ))}
          {tags.length === 0 && !error && !loading && (
            <li className="empty-state">Nenhuma tag ainda.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
