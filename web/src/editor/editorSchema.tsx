/**
 * Schema do editor rico: os mesmos blocos que o editor mostra e exporta.
 *
 * O `toExternalHTML` de imagem e mencao e obrigatorio. Sem ele, o conversor de
 * markdown do BlockNote serializa o HTML renderizado do bloco: a imagem virava
 * `<figure><img src="/api/v1/attachments/<id>?token=...">` dentro do corpo da
 * nota. Isso perdia a referencia `attachment:<id>` (a imagem sumia na proxima
 * abertura) e ainda gravava o token da API no conteudo.
 */

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs } from "@blocknote/core";
import {
  createReactBlockSpec,
  createReactInlineContentSpec,
  type ReactCustomBlockRenderProps,
} from "@blocknote/react";
import { attachmentUrl } from "../api";
import { AudioTrack } from "../components/AudioTrack";
import { MoreIcon } from "../components/icons";
import { useEscape } from "../lib/useEscape";
import type { Audio } from "../types";
import { AUDIO_PLACEHOLDER, audioPropSchema } from "./schema";

// MediaContext gives the media blocks access to the audios (with transcript)
// and to navigation between notes, without going through BlockNote internals.
export const MediaContext = createContext<{
  audios: Map<string, Audio>;
  entryId: string;
  onOpenEntry: (id: string) => void;
}>({ audios: new Map(), entryId: "", onOpenEntry: () => {} });

// ---- inline content: a reference to another note (/link) ----

const noteMention = createReactInlineContentSpec(
  {
    type: "noteMention",
    propSchema: { entryId: { default: "" }, title: { default: "" } },
    content: "none",
  },
  {
    render: (props) => <NoteMention entryId={props.inlineContent.props.entryId} title={props.inlineContent.props.title} />,
    toExternalHTML: (props) => (
      <a href={`note:${props.inlineContent.props.entryId}`}>{props.inlineContent.props.title || "nota"}</a>
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
  { type: "audio", propSchema: audioPropSchema, content: "none" },
  {
    render: (props) => <AudioBlockView attachmentId={props.block.props.attachmentId} />,
    // O bloco nao tem equivalente nativo em markdown. O paragrafo com o
    // marcador e trocado por `!audio[...]` em `blocksToNoteMarkdown`, na mesma
    // posicao em que o app mostra o audio.
    toExternalHTML: (props) => <p>{`${AUDIO_PLACEHOLDER}${props.block.props.attachmentId}`}</p>,
  },
);

function AudioBlockView({ attachmentId }: { attachmentId: string }) {
  const { audios, entryId } = useContext(MediaContext);
  const audio = audios.get(attachmentId);
  if (!audio) {
    return <div className="doc-audio doc-audio--pending">Áudio sendo processado...</div>;
  }
  return (
    <div className="doc-audio">
      <AudioTrack audio={audio} entryId={entryId} />
    </div>
  );
}

/** `![legenda](attachment:<id>)`, com a largura que o app le e escreve. */
const imageConfig = {
  type: "image" as const,
  propSchema: {
    attachmentId: { default: "" },
    caption: { default: "" },
    width: { default: "" },
    // Transitorios: a foto aparece borrada e com giro desde o clique, antes de
    // o upload terminar. Nao vao para o markdown (o bloco pendente e filtrado
    // pelo conversor).
    preview: { default: "" },
    pending: { default: false },
    error: { default: false },
    aspect: { default: "" },
  },
  content: "none" as const,
};

type ImageRenderProps = ReactCustomBlockRenderProps<typeof imageConfig>;

const imageBlock = createReactBlockSpec(
  imageConfig,
  {
    render: (props) => <ImageBlockView {...props} />,
    // A exportacao usa a referencia do anexo, nunca a URL renderizada (que
    // carrega o token): e ela que o app e o servidor sabem ler de volta.
    toExternalHTML: (props) => {
      // Enquanto o upload nao termina, o bloco nao entra no corpo: gravar um
      // `attachment:` vazio perderia a foto na proxima abertura.
      if (props.block.props.pending || props.block.props.error || !props.block.props.attachmentId) {
        return <p />;
      }
      const pct = Number(props.block.props.width);
      return (
        <img
          src={`attachment:${props.block.props.attachmentId}`}
          alt={props.block.props.caption || undefined}
          width={pct > 0 && pct < 100 ? `${pct}%` : undefined}
        />
      );
    },
  },
);

/** Limites da alca de redimensionamento (porcentagem da coluna). */
const MIN_WIDTH = 20;
const MAX_WIDTH = 100;

/**
 * Valor persistido da largura: vazio significa 100% (o padrao que o app nao
 * precisa escrever). O resto vira a porcentagem inteira dentro dos limites.
 */
export function imageWidthValue(percent: number): string {
  const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(percent)));
  return clamped >= MAX_WIDTH ? "" : String(clamped);
}

const WIDTH_PRESETS = [
  { value: "", label: "Largura total" },
  { value: "75", label: "Três quartos" },
  { value: "50", label: "Metade" },
  { value: "25", label: "Um quarto" },
];

/** Proporcao "largura/altura" vinda do bloco; 0 quando ainda nao se sabe. */
function aspectValue(value: string): number | undefined {
  const [width, height] = value.split("/").map((part) => Number(part));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  return width / height;
}

/**
 * Imagem como no Notion: sem caixa azul de selecao, com alca para arrastar a
 * largura, legenda editavel e um menu com presets, download e remocao. A largura
 * continua sendo o mesmo `{w=N}` que o app le e escreve.
 */
function ImageBlockView({ block, editor }: ImageRenderProps) {
  const stored = Number(block.props.width);
  const initial = Number.isFinite(stored) && stored >= MIN_WIDTH && stored < MAX_WIDTH ? stored : MAX_WIDTH;
  const [width, setWidth] = useState(initial);
  const widthRef = useRef(initial);
  const [caption, setCaption] = useState(block.props.caption);
  const [menu, setMenu] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [loadedId, setLoadedId] = useState("");
  const [naturalAspect, setNaturalAspect] = useState<number | null>(null);
  const drag = useRef<{ startX: number; startWidth: number; column: number } | null>(null);
  const figure = useRef<HTMLElement | null>(null);
  useEscape(menu, () => setMenu(false));

  const pending = block.props.pending;
  const failed = block.props.error;
  const attachmentId = block.props.attachmentId;
  const loaded = attachmentId !== "" && loadedId === attachmentId;
  // A proporcao chega logo depois do clique, quando o navegador mede o arquivo.
  // Enquanto ela nao existe, 4/3 mantem o esqueleto no lugar.
  const aspect = aspectValue(block.props.aspect) ?? naturalAspect ?? undefined;


  // O app pode regravar a nota (pull) com uma largura nova: acompanha.
  useEffect(() => {
    const next = Number(block.props.width);
    const pct = Number.isFinite(next) && next >= MIN_WIDTH && next < MAX_WIDTH ? next : MAX_WIDTH;
    widthRef.current = pct;
    setWidth(pct);
  }, [block.props.width]);
  useEffect(() => {
    setCaption(block.props.caption);
  }, [block.props.caption]);

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (!figure.current?.contains(event.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const commitWidth = (pct: number) => {
    const value = imageWidthValue(pct);
    if (value === block.props.width) return;
    editor.updateBlock(block, { props: { ...block.props, width: value } });
  };

  const beginDrag = (event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const column = figure.current?.parentElement?.clientWidth ?? 720;
    drag.current = { startX: event.clientX, startWidth: widthRef.current, column };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!drag.current) return;
    const delta = ((event.clientX - drag.current.startX) / drag.current.column) * 100;
    const pct = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(drag.current.startWidth + delta)));
    widthRef.current = pct;
    setWidth(pct);
  };

  const endDrag = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
    commitWidth(widthRef.current);
  };

  const commitCaption = () => {
    if (caption === block.props.caption) return;
    editor.updateBlock(block, { props: { ...block.props, caption } });
  };

  const busy = pending || !loaded;

  return (
    <figure
      className={dragging ? "doc-figure doc-figure--active" : "doc-figure"}
      style={{ width: `${width}%` }}
      ref={figure}
    >
      <div className="doc-image-wrap" style={{ aspectRatio: aspect ?? 4 / 3 }}>
        {block.props.preview ? (
          // Miniatura local borrada: aparece no mesmo clique, antes de o upload
          // terminar, para a nota nao ficar parada por segundos.
          <img className="doc-image-blur" src={block.props.preview} alt="" aria-hidden="true" />
        ) : null}
        {attachmentId ? (
          <img
            className={loaded ? "doc-image doc-image--loaded" : "doc-image"}
            src={attachmentUrl(attachmentId)}
            alt={block.props.caption || "Imagem da nota"}
            loading="lazy"
            onLoad={(event) => {
              const image = event.currentTarget;
              if (!aspect && image.naturalWidth > 0 && image.naturalHeight > 0) {
                setNaturalAspect(image.naturalWidth / image.naturalHeight);
              }
              setLoadedId(attachmentId);
            }}
            onError={() => setLoadedId(attachmentId)}
          />
        ) : null}
        {failed ? (
          <div className="doc-image-error" role="status">
            <span>Não foi possível enviar a foto.</span>
            <button
              type="button"
              className="doc-image-error-remove"
              onClick={() => editor.removeBlocks([block])}
            >
              Remover
            </button>
          </div>
        ) : busy ? (
          <div
            className={
              block.props.preview
                ? "doc-image-skeleton doc-image-skeleton--preview"
                : "doc-image-skeleton"
            }
            role="status"
            aria-label="Carregando foto"
          >
            <span className="image-spinner" aria-hidden="true" />
          </div>
        ) : null}
        {!failed && !pending ? (
          <>
            <span
              className="doc-image-handle"
              role="separator"
              aria-label="Redimensionar imagem"
              aria-orientation="vertical"
              title="Arraste para redimensionar"
              onPointerDown={beginDrag}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            />
            {dragging && <span className="doc-image-size">{width}%</span>}
            <div className="doc-image-actions">
              <button
                type="button"
                className="doc-image-button"
                aria-label="Opções da imagem"
                aria-expanded={menu}
                title="Opções da imagem"
                onClick={() => setMenu((value) => !value)}
              >
                <MoreIcon size={14} />
              </button>
              {menu && (
                <div className="doc-image-menu" role="menu">
                  <div className="doc-image-menu-label">Largura</div>
                  {WIDTH_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      role="menuitemradio"
                      aria-checked={(Number(block.props.width) || 100) === (Number(preset.value) || 100)}
                      className="doc-image-menu-item"
                      onClick={() => {
                        const pct = Number(preset.value) || MAX_WIDTH;
                        widthRef.current = pct;
                        setWidth(pct);
                        commitWidth(pct);
                        setMenu(false);
                      }}
                    >
                      {preset.label}
                    </button>
                  ))}
                  <div className="doc-image-menu-rule" role="presentation" />
                  <a
                    className="doc-image-menu-item"
                    href={attachmentUrl(block.props.attachmentId)}
                    download
                    target="_blank"
                    rel="noreferrer"
                  >
                    Baixar imagem
                  </a>
                  <button
                    type="button"
                    className="doc-image-menu-item doc-image-menu-item--danger"
                    role="menuitem"
                    onClick={() => {
                      setMenu(false);
                      editor.removeBlocks([block]);
                    }}
                  >
                    Remover imagem
                  </button>
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
      {!failed && !pending ? (
        <input
          className="doc-image-caption"
          value={caption}
          placeholder="Adicionar legenda"
          aria-label="Legenda da imagem"
          onChange={(event) => setCaption(event.target.value)}
          onBlur={commitCaption}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitCaption();
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              setCaption(block.props.caption);
              event.currentTarget.blur();
            }
          }}
        />
      ) : null}
    </figure>
  );
}

const schema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, audio: audioBlock(), image: imageBlock() },
  inlineContentSpecs: { ...defaultInlineContentSpecs, noteMention },
});

/** Schema compartilhado pelo editor do dashboard (e pelos testes do conversor). */
export function createEditorSchema() {
  return schema;
}
