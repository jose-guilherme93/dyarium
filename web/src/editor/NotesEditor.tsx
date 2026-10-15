import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { Block, PartialBlock } from "@blocknote/core";
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
import { attachmentUrl, uploadAttachment, uploadFile } from "../api";
import type { Audio, Entry } from "../types";
import { AudioTrack } from "../components/AudioTrack";

// MediaRef is one medium to place in the document (used to migrate notes whose
// media lived outside the document, before inline blocks existed).
export interface MediaRef {
  kind: "audio" | "image";
  id: string;
  createdAt: string;
}

interface NotesEditorProps {
  entryId: string;
  initialContent?: PartialBlock[];
  media?: MediaRef[];
  audios?: Map<string, Audio>;
  onChange?: (blocks: Block[]) => void;
  onMediaAdded?: () => void;
  onOpenEntry?: (id: string) => void;
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
  { type: "image", propSchema: { attachmentId: { default: "" }, caption: { default: "" } }, content: "none" },
  {
    render: (props) => (
      <figure className="doc-figure">
        <img
          className="doc-image"
          src={attachmentUrl(props.block.props.attachmentId)}
          alt={props.block.props.caption || "Imagem da nota"}
          loading="lazy"
        />
        {props.block.props.caption && <figcaption>{props.block.props.caption}</figcaption>}
      </figure>
    ),
  },
);

const schema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, audio: audioBlock(), image: imageBlock() },
  inlineContentSpecs: { ...defaultInlineContentSpecs, noteMention },
});

// ---- helpers ----

function hasMediaBlocks(blocks: PartialBlock[] | undefined): boolean {
  if (!blocks) {
    return false;
  }
  return blocks.some(
    (block) =>
      block.type === "audio" ||
      block.type === "image" ||
      hasMediaBlocks((block as { children?: PartialBlock[] }).children),
  );
}

function mediaBlock(ref: MediaRef): PartialBlock {
  if (ref.kind === "audio") {
    return { type: "audio", props: { attachmentId: ref.id } } as unknown as PartialBlock;
  }
  return { type: "image", props: { attachmentId: ref.id } } as unknown as PartialBlock;
}

// NotesEditor is the rich document of a note: text, audio and images interleaved
// in one flow, plus the /link command.
export function NotesEditor({
  entryId,
  initialContent,
  media = [],
  audios = new Map(),
  onChange,
  onMediaAdded,
  onOpenEntry,
}: NotesEditorProps) {
  const mediaMigrated =
    !hasMediaBlocks(initialContent) && media.length > 0;
  const seeded = mediaMigrated
    ? [...media.map(mediaBlock), ...(initialContent ?? [])]
    : initialContent;

  const editor = useCreateBlockNote({ schema, initialContent: seeded, dictionary: pt });
  const [dark, setDark] = useState(
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const audioInput = useRef<HTMLInputElement | null>(null);
  const imageInput = useRef<HTMLInputElement | null>(null);
  const migratedRef = useRef(mediaMigrated);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => setDark(query.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  const addMedia = () => {
    try {
      return editor.getTextCursorPosition()?.block ?? editor.document[editor.document.length - 1];
    } catch {
      return editor.document[editor.document.length - 1];
    }
  };

  const insert = (ref: { kind: "audio" | "image"; id: string }) => {
    const block = addMedia();
    type InsertedBlock = Parameters<typeof editor.insertBlocks>[0][number];
    editor.insertBlocks([mediaBlock({ ...ref, createdAt: "" }) as unknown as InsertedBlock], block, "after");
    void onChange?.(editor.document as unknown as Block[]);
    onMediaAdded?.();
  };

  const onAudioFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      const result = await uploadFile(file, undefined, entryId);
      insert({ kind: "audio", id: result.attachment_id });
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
      insert({ kind: "image", id: attachment.id });
    } catch {
      // Ignore; the image simply is not added.
    }
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

  return (
    <MediaContext.Provider value={{ audios, onOpenEntry: onOpenEntry ?? (() => {}) }}>
      <BlockNoteView
        editor={editor}
        theme={dark ? "dark" : "light"}
        slashMenu={false}
        onChange={() => onChange?.(editor.document as unknown as Block[])}
      >
        <SuggestionMenuController triggerCharacter="/" getItems={getItems} />
      </BlockNoteView>

      <input ref={audioInput} type="file" accept="audio/*" hidden onChange={(event) => void onAudioFile(event)} />
      <input ref={imageInput} type="file" accept="image/*" hidden onChange={(event) => void onImageFile(event)} />

      {migratedRef.current && (
        // Persist the migrated media blocks once, right after the document loads.
        <MigrateOnMount onReady={() => void onChange?.(editor.document as unknown as Block[])} />
      )}
    </MediaContext.Provider>
  );
}

// MigrateOnMount fires a single onChange after the editor is created so the
// migrated document is saved.
function MigrateOnMount({ onReady }: { onReady: () => void }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) {
      return;
    }
    done.current = true;
    onReady();
  }, [onReady]);
  return null;
}

// mediaRefs builds the ordered media list (audios and images by creation time)
// used to migrate a note whose media lived outside the document.
export function mediaRefs(entry: Entry, images: { id: string; created_at: string }[]): MediaRef[] {
  const refs: MediaRef[] = [
    ...(entry.audios ?? []).map((audio) => ({ kind: "audio" as const, id: audio.id, createdAt: audio.created_at })),
    ...images.map((image) => ({ kind: "image" as const, id: image.id, createdAt: image.created_at })),
  ];
  return refs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export default NotesEditor;
