import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { CloseIcon } from "./icons";

interface TagEditorProps {
  entryId: string;
  onChanged: () => void;
}

// TagEditor manages the tags of a note. Existing tags live in a shared bank
// (GET /tags) and are suggested here, so any note can reuse a tag created
// anywhere.
export function TagEditor({ entryId, onChanged }: TagEditorProps) {
  const [tags, setTags] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const blurTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    const [entryRes, allRes] = await Promise.allSettled([api.listEntryTags(entryId), api.listTags()]);
    if (entryRes.status === "fulfilled") {
      setTags(entryRes.value.tags.map((tag) => tag.name));
    }
    if (allRes.status === "fulfilled") {
      setAllTags(allRes.value.tags.map((tag) => tag.name));
    }
  }, [entryId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (names: string[]) => {
    setTags(names);
    try {
      await api.setEntryTags(entryId, names);
      setError("");
      onChanged();
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao salvar tags");
    }
  };

  const add = (raw: string) => {
    const name = raw.trim();
    setInput("");
    if (!name || tags.some((tag) => tag.toLowerCase() === name.toLowerCase())) {
      return;
    }
    void save([...tags, name]);
  };

  const query = input.trim().toLowerCase();
  const suggestions = allTags
    .filter((tag) => !tags.some((current) => current.toLowerCase() === tag.toLowerCase()))
    .filter((tag) => tag.toLowerCase().includes(query))
    .slice(0, 8);

  return (
    <div className="tags-row">
      {tags.map((tag) => (
        <span key={tag} className="tag-chip">
          {tag}
          <button
            type="button"
            className="tag-remove"
            onClick={() => void save(tags.filter((item) => item !== tag))}
            aria-label={`Remover tag ${tag}`}
          >
            <CloseIcon size={12} />
          </button>
        </span>
      ))}
      <div className="tag-add">
        <input
          className="tag-input"
          value={input}
          placeholder="+ tag"
          aria-label="Adicionar tag"
          onChange={(event) => {
            setInput(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            blurTimer.current = window.setTimeout(() => setOpen(false), 150);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add(input);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {open && suggestions.length > 0 && (
          <ul className="tag-suggest" role="listbox" aria-label="Tags existentes">
            {suggestions.map((tag) => (
              <li key={tag}>
                <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => add(tag)}>
                  {tag}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && <span className="error">{error}</span>}
    </div>
  );
}

export default TagEditor;
