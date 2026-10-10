import type { Block, PartialBlock } from "@blocknote/core";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";

interface NotesEditorProps {
  initialContent?: PartialBlock[];
  onChange?: (blocks: Block[]) => void;
}

// NotesEditor provides the rich text note editor backed by BlockNote.
export function NotesEditor({ initialContent, onChange }: NotesEditorProps) {
  const editor = useCreateBlockNote({ initialContent });
  return <BlockNoteView editor={editor} onChange={() => onChange?.(editor.document)} />;
}

export default NotesEditor;
