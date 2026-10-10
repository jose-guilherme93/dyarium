import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";

// NotesEditor provides the rich text note editor. It is wired into the entry
// view in a later phase; here it verifies the BlockNote integration compiles
// and is ready to use.
export function NotesEditor() {
  const editor = useCreateBlockNote();
  return <BlockNoteView editor={editor} />;
}

export default NotesEditor;
