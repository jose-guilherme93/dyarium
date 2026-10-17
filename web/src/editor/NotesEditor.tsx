import { createContext, forwardRef, useContext, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { PartialBlock } from "@blocknote/core";
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs } from "@blocknote/core";
import { pt } from "@blocknote/core/locales";
import {
  createReactBlockSpec,
  createReactInlineContentSpec,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  useCreateBlockNote,
  type DefaultReactSuggestionItem,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { attachmentUrl, api, uploadAttachment, uploadFile } from "../api";
import { blocksToNoteMarkdown } from "./blocknoteMarkdown";
import type { Audio, Entry } from "../types";
import { AudioTrack } from "../components/AudioTrack";

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

// MediaContext gives the media blocks access to the audios (with transcript) and
// to navigation, without going through BlockNote internals.
const MediaContext = createContext<{
  audios: Map<string, Audio>;
  onOpenEntry: (id: string) => void;
}>({ audios: new Map(), onOpenEntry: () => {} });

// ---- inline content: a reference to another note (/link) ----

const noteMention = createReactInlineContentSpec(
  {
    type: "noteMention",
    propSchema: { entryId: { default: "" }, title: { default: "" } },
    content: "none",
  },
  {
    render: (props) => (
      <NoteMention entryId={props.inlineContent.props.entryId} title={props.inlineContent.props.title} />
    ),
  },
);

function NoteMention({ entryId, title }: { entryId: string; title: string }) {
  const { onOpenEntry } = useContext(MediaContext);
  return (
    <button
      type="button"
      className="note-mention"
      onClick={() => {
        if (entryId) {
          onOpenEntry(entryId);
        }
      }}
    >
      {title || "nota"}
    </button>
  );
}

// ---- blocks: audio and image ----

const audioBlock = createReactBlockSpec(
  { type: "audio", propSchema: { attachmentId: { default: "" } }, content: "none" },
  {
    render: (props) => <AudioBlockView attachmentId={props.block.props.attachmentId} />,
  },
);

function AudioBlockView({ attachmentId }: { attachmentId: string }) {
  const { audios } = useContext(MediaContext);
  const audio = audios.get(attachmentId);
  if (!audio) {
    return <div className="doc-audio doc-audio--pending">Audio sendo processado...</div>;
  }
  return <AudioTrack audio={audio} />;
}

const imageBlock = createReactBlockSpec(
  {
    type: "image",
    propSchema: { attachmentId: { default: "" }, caption: { default: "" }, width: { default: "" } },
    content: "none",
  },
  {
    render: (props) => (
      <figure className="doc-figure">
        <img
          className="doc-image"
          src={attachmentUrl(props.block.props.attachmentId)}
          alt={props.block.props.caption || "Imagem da nota"}
          // `width` e a largura escolhida no app (50 = metade da largura da nota).
          style={imageWidth(props.block.props.width)}
          loading="lazy"
        />
        {props.block.props.caption && <figcaption>{props.block.props.caption}</figcaption>}
      </figure>
    ),
  },
);

/** Largura da imagem em porcentagem da coluna (vazio = largura total). */
function imageWidth(width: string): { width: string } | undefined {
  const pct = Number(width);
  if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) {
    return undefined;
  }
  return { width: `${pct}%` };
}

const schema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, audio: audioBlock(), image: imageBlock() },
  inlineContentSpecs: { ...defaultInlineContentSpecs, noteMention },
});

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
