import { useEffect, useState } from "react";
import type { Block, PartialBlock } from "@blocknote/core";
import { pt } from "@blocknote/core/locales";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";

interface NotesEditorProps {
  initialContent?: PartialBlock[];
  onChange?: (blocks: Block[]) => void;
}

// NotesEditor is the rich text body of a note, backed by BlockNote. It follows
// the system color scheme so it blends with the app theme.
export function NotesEditor({ initialContent, onChange }: NotesEditorProps) {
  const editor = useCreateBlockNote({ initialContent, dictionary: pt });
  const [dark, setDark] = useState(
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => setDark(query.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  return (
    <BlockNoteView
      editor={editor}
      theme={dark ? "dark" : "light"}
      onChange={() => onChange?.(editor.document)}
    />
  );
}

export default NotesEditor;
