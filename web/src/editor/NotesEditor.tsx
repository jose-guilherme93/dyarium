import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Block, PartialBlock } from "@blocknote/core";
import { pt } from "@blocknote/core/locales";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";

interface NotesEditorProps {
  initialContent?: PartialBlock[];
  onChange?: (blocks: Block[]) => void;
}

export interface NotesEditorHandle {
  /** Move o foco para o corpo da nota, para o usuario comecar a escrever. */
  focus(): void;
}

// NotesEditor is the rich text body of a note, backed by BlockNote. It follows
// the system color scheme so it blends with the app theme.
export const NotesEditor = forwardRef<NotesEditorHandle, NotesEditorProps>(function NotesEditor(
  { initialContent, onChange },
  ref,
) {
  const editor = useCreateBlockNote({ initialContent, dictionary: pt });
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dark, setDark] = useState(
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        const target = wrapRef.current?.querySelector<HTMLElement>('[contenteditable="true"]');
        target?.focus();
      },
    }),
    [],
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => setDark(query.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  return (
    <div ref={wrapRef}>
      <BlockNoteView editor={editor} theme={dark ? "dark" : "light"} onChange={() => onChange?.(editor.document)} />
    </div>
  );
});

export default NotesEditor;
