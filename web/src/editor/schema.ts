/**
 * Schema do editor de notas, sem React: o mesmo conjunto de blocos e o mesmo
 * conversor markdown servem para o editor do dashboard e para o script de
 * conversao, entao os dois nunca discordam sobre o que e markdown.
 */

import {
  BlockNoteSchema,
  createBlockSpec,
  createInlineContentSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
} from "@blocknote/core";

/** Audio dentro do documento (o audio da pilha do topo nao usa isto). */
export const audioBlockSpec = () =>
  createBlockSpec(
    { type: "audio", propSchema: { attachmentId: { default: "" } }, content: "none" },
    { render: () => ({ dom: document.createElement("div") }) },
  )();

/**
 * Imagem da nota, em markdown: `![legenda](attachment:id)` e, quando a imagem nao
 * ocupa a largura toda, o marcador `{w=50}` que o app ja le e escreve.
 *
 * O BlockNote so sabe serializar imagem vindo de HTML, entao o block exporta uma
 * tag `<img>` com o `src` no endereco do anexo. Sem isso, toda imagem da nota
 * sumiria ao salvar em markdown.
 */
export const imageBlockSpec = () =>
  createBlockSpec(
    {
      type: "image",
      propSchema: { attachmentId: { default: "" }, caption: { default: "" }, width: { default: "" } },
      content: "none",
    },
    {
      render: () => ({ dom: document.createElement("div") }),
      toExternalHTML: (block: { props: Record<string, string> }) => {
        const { attachmentId, caption, width } = block.props;
        const pct = Number(width);
        const img = document.createElement("img");
        img.setAttribute("src", `attachment:${attachmentId}`);
        if (caption) img.setAttribute("alt", caption);
        if (pct > 0 && pct < 100) img.setAttribute("width", `${pct}%`);
        return { dom: img };
      },
    },
  )();

/** Referencia a outra nota (/link). */
export const noteMentionSpec = () =>
  createInlineContentSpec(
    {
      type: "noteMention",
      propSchema: { entryId: { default: "" }, title: { default: "" } },
      content: "none",
    },
    { render: () => ({ dom: document.createElement("span") }) },
  );

/**
 * Schema compartilhado entre o editor do dashboard e o script de conversao, para
 * os dois nunca discordarem sobre o que e markdown.
 */
export function createNoteSchema() {
  return BlockNoteSchema.create({
    blockSpecs: { ...defaultBlockSpecs, audio: audioBlockSpec(), image: imageBlockSpec() },
    inlineContentSpecs: { ...defaultInlineContentSpecs, noteMention: noteMentionSpec() },
  });
}

/** Tipos de bloco que o markdown do BlockNote nao representa como estrutura. */
export const LOSSY_BLOCK_TYPES = new Set(["file", "video"]);

/**
 * Blocos que o app nao edita: continuam no corpo como texto do proprio bloco,
 * preservados na ida e na volta. O app mostra em somente leitura.
 */
export function isReadOnlyBlockType(type: string): boolean {
  return LOSSY_BLOCK_TYPES.has(type) || type === "table" || type === "divider" || type === "audio";
}