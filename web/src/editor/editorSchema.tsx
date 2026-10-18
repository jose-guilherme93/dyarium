/**
 * Schema do editor rico: os mesmos blocos que o editor mostra e exporta.
 *
 * O `toExternalHTML` de imagem e mencao e obrigatorio. Sem ele, o conversor de
 * markdown do BlockNote serializa o HTML renderizado do bloco: a imagem virava
 * `<figure><img src="/api/v1/attachments/<id>?token=...">` dentro do corpo da
 * nota. Isso perdia a referencia `attachment:<id>` (a imagem sumia na proxima
 * abertura) e ainda gravava o token da API no conteudo.
 */

import { createContext, useContext } from "react";
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs } from "@blocknote/core";
import { createReactBlockSpec, createReactInlineContentSpec } from "@blocknote/react";
import { attachmentUrl } from "../api";
import { AudioTrack } from "../components/AudioTrack";
import type { Audio } from "../types";

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
  { type: "audio", propSchema: { attachmentId: { default: "" } }, content: "none" },
  {
    render: (props) => <AudioBlockView attachmentId={props.block.props.attachmentId} />,
    // O audio da nota vive na pilha do topo, fora do corpo. Um bloco antigo que
    // ainda exista no documento nao deve despejar o player no markdown.
    toExternalHTML: () => <div />,
  },
);

function AudioBlockView({ attachmentId }: { attachmentId: string }) {
  const { audios, entryId } = useContext(MediaContext);
  const audio = audios.get(attachmentId);
  if (!audio) {
    return <div className="doc-audio doc-audio--pending">Audio sendo processado...</div>;
  }
  return <AudioTrack audio={audio} entryId={entryId} />;
}

/** `![legenda](attachment:<id>)`, com a largura que o app le e escreve. */
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
    // A exportacao usa a referencia do anexo, nunca a URL renderizada (que
    // carrega o token): e ela que o app e o servidor sabem ler de volta.
    toExternalHTML: (props) => {
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

/** Schema compartilhado pelo editor do dashboard (e pelos testes do conversor). */
export function createEditorSchema() {
  return schema;
}
