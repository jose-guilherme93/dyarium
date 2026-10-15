import { createContext, useContext, useEffect, useState } from "react";
import type { Block, PartialBlock } from "@blocknote/core";
import { BlockNoteSchema, defaultInlineContentSpecs } from "@blocknote/core";
import { pt } from "@blocknote/core/locales";
import {
  createReactInlineContentSpec,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  useCreateBlockNote,
  type DefaultReactSuggestionItem,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { api } from "../api";
import type { Entry } from "../types";

interface NotesEditorProps {
  entryId: string;
  initialContent?: PartialBlock[];
  onChange?: (blocks: Block[]) => void;
  onOpenEntry?: (id: string) => void;
}

// OpenEntryContext lets the inline note mention open the referenced note
// without threading the handler through BlockNote internals.
const OpenEntryContext = createContext<(id: string) => void>(() => {});

// noteMention is an inline reference to another note, inserted by the /link
// slash command.
const noteMention = createReactInlineContentSpec(
  {
    type: "noteMention",
    propSchema: {
      entryId: { default: "" },
      title: { default: "" },
    },
    content: "none",
  },
  {
    render: (props) => (
      <NoteMention entryId={props.inlineContent.props.entryId} title={props.inlineContent.props.title} />
    ),
  },
);

const schema = BlockNoteSchema.create({
  inlineContentSpecs: { ...defaultInlineContentSpecs, noteMention },
});

function NoteMention({ entryId, title }: { entryId: string; title: string }) {
  const open = useContext(OpenEntryContext);
  return (
    <button
      type="button"
      className="note-mention"
      onClick={() => {
        if (entryId) {
          open(entryId);
        }
      }}
    >
      {title || "nota"}
    </button>
  );
}

function entryLabel(entry: Entry): string {
  return entry.title || entry.original_filename || "Nota";
}

// NotesEditor is the rich text body of a note, backed by BlockNote. It follows
// the system color scheme and adds the /link command that references other
// notes.
export function NotesEditor({ entryId, initialContent, onChange, onOpenEntry }: NotesEditorProps) {
  const editor = useCreateBlockNote({ schema, initialContent, dictionary: pt });
  const [dark, setDark] = useState(
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [picker, setPicker] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [term, setTerm] = useState("");

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => setDark(query.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  useEffect(() => {
    if (!picker) {
      return;
    }
    let active = true;
    api
      .listEntries()
      .then((result) => {
        if (active) {
          setEntries(result.entries ?? []);
        }
      })
      .catch(() => {
        if (active) {
          setEntries([]);
        }
      });
    return () => {
      active = false;
    };
  }, [picker]);

  const insertMention = (entry: Entry) => {
    const label = entryLabel(entry);
    editor.insertInlineContent([
      { type: "noteMention", props: { entryId: entry.id, title: label } },
      " ",
    ]);
    // Record the relation on the server so it can power backlinks later.
    void api.createLink(entryId, { to_entry_id: entry.id, label }).catch(() => {});
    setPicker(false);
    setTerm("");
  };

  const getItems = async (query: string): Promise<DefaultReactSuggestionItem[]> => {
    const items = getDefaultReactSlashMenuItems(editor);
    const extra: DefaultReactSuggestionItem[] = [
      {
        title: "Link para nota",
        subtext: "Referencia outra nota do diario",
        aliases: ["link", "nota", "referencia", "mencao"],
        group: "dyarium",
        onItemClick: () => setPicker(true),
      },
    ];
    const all = [...items, ...extra];
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return all;
    }
    return all.filter(
      (item) =>
        item.title.toLowerCase().includes(needle) ||
        (item.aliases ?? []).some((alias) => alias.toLowerCase().includes(needle)),
    );
  };

  const filtered = entries.filter((entry) => entryLabel(entry).toLowerCase().includes(term.trim().toLowerCase()));

  // The editor carries a custom schema (the noteMention inline content); the
  // parent only serializes the document, so the cast to the default Block type
  // is safe here.
  const handleChange = () => onChange?.(editor.document as unknown as Block[]);

  return (
    <OpenEntryContext.Provider value={onOpenEntry ?? (() => {})}>
      <BlockNoteView
        editor={editor}
        theme={dark ? "dark" : "light"}
        slashMenu={false}
        onChange={handleChange}
      >
        <SuggestionMenuController triggerCharacter="/" getItems={getItems} />
      </BlockNoteView>

      {picker && (
        <div className="note-picker" role="dialog" aria-modal="true" aria-label="Link para nota">
          <div className="note-picker-backdrop" onClick={() => setPicker(false)} />
          <div className="note-picker-card">
            <div className="note-picker-head">
              <h3>Link para nota</h3>
              <button type="button" onClick={() => setPicker(false)}>
                Fechar
              </button>
            </div>
            <input
              autoFocus
              type="search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Buscar nota"
              aria-label="Buscar nota para vincular"
            />
            <ul className="note-picker-list">
              {filtered.length === 0 ? (
                <li className="muted">Nenhuma nota encontrada.</li>
              ) : (
                filtered.map((entry) => (
                  <li key={entry.id}>
                    <button type="button" onClick={() => insertMention(entry)}>
                      {entryLabel(entry)}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      )}
    </OpenEntryContext.Provider>
  );
}

export default NotesEditor;
