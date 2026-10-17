import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { PartialBlock } from "@blocknote/core";
import { pt } from "@blocknote/core/locales";
import {
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  useCreateBlockNote,
  type DefaultReactSuggestionItem,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { api, uploadAttachment, uploadFile } from "../api";
import { blocksToNoteMarkdown } from "./blocknoteMarkdown";
import { createEditorSchema, MediaContext } from "./editorSchema";
import type { Audio, Entry } from "../types";

interface NotesEditorProps {
  entryId: string;
  initialContent?: PartialBlock[];
  audios?: Map<string, Audio>;
  /**
   * Mudanca no corpo. Entrega o **markdown** (o formato canonico dos dois
   * lados), nao os blocos: quem salva nao precisa conhecer o BlockNote.
   */
  onChange?: (markdown: string) => void;
  onMediaAdded?: () => void;
  onOpenEntry?: (id: string) => void;
}

// NotesEditorHandle lets the note header trigger the media/link inserters that
// live inside the editor (which owns the file inputs and the picker).
export interface NotesEditorHandle {
  addImage: () => void;
  addAudio: () => void;
  openLink: () => void;
}

const schema = createEditorSchema();

// NotesEditor is the written body of a note (markdown): text and images, plus the
// /link command. Audio is not part of the body anymore: the stack of audios sits
// at the top of the note, outside the document.
export const NotesEditor = forwardRef<NotesEditorHandle, NotesEditorProps>(function NotesEditor(
  { entryId, initialContent, audios = new Map(), onChange, onMediaAdded, onOpenEntry },
  ref,
) {
  const editor = useCreateBlockNote({ schema, initialContent, dictionary: pt });
  const [dark, setDark] = useState(
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const audioInput = useRef<HTMLInputElement | null>(null);
  const imageInput = useRef<HTMLInputElement | null>(null);
  const [picker, setPicker] = useState(false);
  const [pickerEntries, setPickerEntries] = useState<Entry[]>([]);
  const [term, setTerm] = useState("");

  useImperativeHandle(ref, () => ({
    addImage: () => imageInput.current?.click(),
    addAudio: () => audioInput.current?.click(),
    openLink: () => setPicker(true),
  }));

  useEffect(() => {
    if (!picker) {
      return;
    }
    let active = true;
    api
      .listEntries()
      .then((result) => {
        if (active) {
          setPickerEntries(result.entries ?? []);
        }
      })
      .catch(() => {
        if (active) {
          setPickerEntries([]);
        }
      });
    return () => {
      active = false;
    };
  }, [picker]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => setDark(query.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  /** Markdown do documento atual, como o app e o servidor falam. */
  const emit = () => onChange?.(blocksToNoteMarkdown(editor, editor.document as never[]));

  const addMedia = () => {
    try {
      return editor.getTextCursorPosition()?.block ?? editor.document[editor.document.length - 1];
    } catch {
      return editor.document[editor.document.length - 1];
    }
  };

  /** Insere a imagem no corpo, como bloco (o audio nao entra no corpo). */
  const insertImage = (id: string) => {
    const block = addMedia();
    type InsertedBlock = Parameters<typeof editor.insertBlocks>[0][number];
    editor.insertBlocks(
      [{ type: "image", props: { attachmentId: id } } as unknown as InsertedBlock],
      block,
      "after",
    );
    emit();
    onMediaAdded?.();
  };

  const onAudioFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      // O audio entra na pilha da nota, no servidor: nao ha bloco de audio no
      // corpo, e a pilha aparece no topo assim que a nota recarrega.
      await uploadFile(file, undefined, entryId);
      onMediaAdded?.();
    } catch {
      // The pending block already communicates failure; keep the editor calm.
    }
  };

  const onImageFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      const attachment = await uploadAttachment(entryId, file);
      insertImage(attachment.id);
    } catch {
      // Ignore; the image simply is not added.
    }
  };

  const insertMention = (entry: Entry) => {
    const label = entry.title || entry.original_filename || "Nota";
    type Content = Parameters<typeof editor.insertInlineContent>[0];
    try {
      editor.insertInlineContent([
        { type: "noteMention", props: { entryId: entry.id, title: label } },
        " ",
      ] as unknown as Content);
      emit();
    } catch {
      // Ignore; the mention simply is not inserted.
    }
    if (entryId) {
      void api.createLink(entryId, { to_entry_id: entry.id, label }).catch(() => {});
    }
    setPicker(false);
    setTerm("");
  };

  const getItems = async (query: string): Promise<DefaultReactSuggestionItem[]> => {
    // Drop the built-in media items ("Midia"): we replace image/audio with our
    // upload-based blocks.
    const items = getDefaultReactSlashMenuItems(editor).filter((item) => item.group !== "Mídia");
    const extra: DefaultReactSuggestionItem[] = [
      {
        title: "Audio",
        subtext: "Gravar ou enviar um audio aqui",
        aliases: ["audio", "gravar", "voz", "enviar"],
        group: "Midia",
        onItemClick: () => audioInput.current?.click(),
      },
      {
        title: "Foto",
        subtext: "Enviar uma imagem para o documento",
        aliases: ["foto", "imagem", "image", "print"],
        group: "Midia",
        onItemClick: () => imageInput.current?.click(),
      },
      {
        title: "Link para nota",
        subtext: "Referenciar outra nota do diario",
        aliases: ["link", "nota", "referencia", "mencao"],
        group: "Midia",
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

  const filtered = pickerEntries.filter((entry) =>
    (entry.title || entry.original_filename || "").toLowerCase().includes(term.trim().toLowerCase()),
  );

  return (
    <MediaContext.Provider value={{ audios, onOpenEntry: onOpenEntry ?? (() => {}) }}>
      <BlockNoteView
        editor={editor}
        theme={dark ? "dark" : "light"}
        slashMenu={false}
        onChange={() => emit()}
      >
        <SuggestionMenuController triggerCharacter="/" getItems={getItems} />
      </BlockNoteView>

      <input ref={audioInput} type="file" accept="audio/*" hidden onChange={(event) => void onAudioFile(event)} />
      <input ref={imageInput} type="file" accept="image/*" hidden onChange={(event) => void onImageFile(event)} />

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
                      {entry.title || entry.original_filename || "Nota"}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      )}
    </MediaContext.Provider>
  );
});

export default NotesEditor;
