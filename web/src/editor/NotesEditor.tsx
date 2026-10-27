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
import { CloseIcon } from "../components/icons";
import { useEscape } from "../lib/useEscape";
import { blocksToNoteMarkdown } from "./blocknoteMarkdown";
import { createEditorSchema, MediaContext } from "./editorSchema";
import type { Audio, Entry } from "../types";

interface NotesEditorProps {
  entryId: string;
  initialContent?: PartialBlock[];
  audios?: Map<string, Audio>;
  /**
   * Mudanca no corpo. Entrega o **markdown** (o formato canonico dos dois
   * lados), não os blocos: quem salva não precisa conhecer o BlockNote.
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

// NotesEditor is the written body of a note (markdown): text, images and audio,
// plus the /link command. Audio and image are media blocks with the same markers
// the app reads and writes.
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

  /** Insere midia no corpo, logo depois do bloco em que o cursor esta. */
  const insertBlockAfterCursor = (
    block: Record<string, unknown>,
    options?: { commit?: boolean },
  ) => {
    const target = addMedia();
    type InsertedBlock = Parameters<typeof editor.insertBlocks>[0][number];
    const inserted = editor.insertBlocks([block as unknown as InsertedBlock], target, "after");
    if (options?.commit !== false) {
      emit();
      onMediaAdded?.();
    }
    return inserted[0];
  };

  /** Dimensoes naturais da foto, para o esqueleto ja nascer com o tamanho certo. */
  const readImageDimensions = (file: File) =>
    new Promise<{ width: number; height: number } | null>((resolve) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        const size =
          image.naturalWidth > 0 && image.naturalHeight > 0
            ? { width: image.naturalWidth, height: image.naturalHeight }
            : null;
        URL.revokeObjectURL(url);
        resolve(size);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      image.src = url;
    });

  /** Duracao do arquivo local, em milissegundos (0 quando nao da para ler). */
  const readDuration = (file: File) =>
    new Promise<number>((resolve) => {
      const url = URL.createObjectURL(file);
      const audio = new Audio();
      const done = (value: number) => {
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(value) && value > 0 ? Math.round(value * 1000) : 0);
      };
      audio.preload = "metadata";
      audio.onloadedmetadata = () => done(audio.duration);
      audio.onerror = () => done(0);
      audio.src = url;
    });

  /** Segundos no mesmo formato que o app grava no marcador (`{d=12.5}`). */
  const markedSeconds = (milliseconds: number) => {
    if (milliseconds <= 0) return "";
    return (milliseconds / 1000).toFixed(3).replace(/\.?0+$/, "");
  };

  const insertAudio = (id: string, milliseconds: number) => {
    insertBlockAfterCursor({
      type: "audio",
      props: { attachmentId: id, duration: markedSeconds(milliseconds) },
    });
  };

  const onAudioFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      // O audio sobe como anexo e entra no corpo no ponto do cursor: o mesmo
      // marcador que o app le, na mesma posicao em que ele vai mostrar.
      const [uploaded, duration] = await Promise.all([
        uploadFile(file, undefined, entryId),
        readDuration(file),
      ]);
      insertAudio(uploaded.attachment_id, duration);
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
    // A foto entra no documento ainda sem anexo, com a miniatura local borrada
    // e um giro no centro. O upload/recompressao continua atras; so quando ele
    // termina o bloco ganha o `attachment:<id>` e passa a valer no markdown.
    const preview = URL.createObjectURL(file);
    const block = insertBlockAfterCursor(
      {
        type: "image",
        props: {
          attachmentId: "",
          caption: "",
          width: "",
          preview,
          pending: true,
          error: false,
          aspect: "",
        },
      },
      { commit: false },
    );
    if (!block) {
      URL.revokeObjectURL(preview);
      return;
    }

    /** Atualiza so as props pedidas, sem reverter o que outra etapa ja mudou. */
    const patchBlock = (props: Record<string, unknown>) => {
      const current = editor.getBlock(block.id);
      if (!current) return;
      editor.updateBlock(current, {
        props: { ...current.props, ...props } as typeof current.props,
      });
    };

    // Medir a foto e barato e paralelo ao upload; o esqueleto comeca em 4/3 e
    // logo assume a proporcao real, sem esperar a imagem do servidor.
    void readImageDimensions(file).then((size) => {
      if (!size) return;
      patchBlock({ aspect: `${size.width}/${size.height}` });
    });

    try {
      const attachment = await uploadAttachment(entryId, file);
      patchBlock({
        attachmentId: attachment.id,
        preview: "",
        pending: false,
        error: false,
      });
      URL.revokeObjectURL(preview);
      emit();
      onMediaAdded?.();
    } catch {
      // O bloco fica no lugar com a mensagem e o botao de remover: a foto nao
      // some em silencio, como acontecia quando o upload falhava.
      patchBlock({ preview: "", pending: false, error: true });
      URL.revokeObjectURL(preview);
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
        title: "Áudio",
        subtext: "Enviar um áudio aqui",
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
        aliases: ["link", "nota", "referencia", "menção"],
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

  useEscape(picker, () => {
    setPicker(false);
    setTerm("");
  });

  const filtered = pickerEntries.filter((entry) =>
    `${entry.title} ${entry.original_filename ?? ""} ${entry.preview ?? ""}`
      .toLowerCase()
      .includes(term.trim().toLowerCase()),
  );

  return (
    <MediaContext.Provider value={{ audios, entryId, onOpenEntry: onOpenEntry ?? (() => {}) }}>
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
              <div>
                <h3>Link para nota</h3>
                <p className="muted">A nota escolhida entra como menção, com um link entre as duas.</p>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setPicker(false)}
                aria-label="Fechar"
                title="Fechar"
              >
                <CloseIcon size={15} />
              </button>
            </div>
            <input
              autoFocus
              type="search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setPicker(false);
                if (event.key === "Enter" && filtered[0]) insertMention(filtered[0]);
              }}
              placeholder="Buscar pelo título ou pelo texto"
              aria-label="Buscar nota para vincular"
            />
            <ul className="note-picker-list">
              {filtered.length === 0 ? (
                <li className="muted note-picker-empty">Nenhuma nota encontrada.</li>
              ) : (
                filtered.map((entry) => (
                  <li key={entry.id}>
                    <button type="button" onClick={() => insertMention(entry)}>
                      <span className="note-picker-title">
                        {entry.title || entry.original_filename || "Nota"}
                      </span>
                      <span className="note-picker-meta">
                        {new Date(entry.recorded_at ?? entry.created_at).toLocaleDateString("pt-BR")}
                        {entry.preview ? ` · ${entry.preview}` : ""}
                      </span>
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
