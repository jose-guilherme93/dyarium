import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { CloseIcon } from "./icons";

interface TagEditorProps {
  entryId: string;
  onChanged: () => void;
}

// TagEditor manages the tags of a note.
export function TagEditor({ entryId, onChanged }: TagEditorProps) {
  const [tags, setTags] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao salvar tags");
    }
  };

  const add = () => {
    const name = input.trim();
    setInput("");
    if (!name || tags.some((tag) => tag.toLowerCase() === name.toLowerCase())) {
      return;
    }
    void save([...tags, name]);
  };

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
      <input
        className="tag-input"
        list="tag-suggestions"
        value={input}
        placeholder="+ tag"
        aria-label="Adicionar tag"
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
      <datalist id="tag-suggestions">
        {allTags.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>
      {error && <span className="error">{error}</span>}
    </div>
  );
}

export default TagEditor;
