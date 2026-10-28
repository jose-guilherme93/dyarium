/**
 * Schema do editor de notas, sem React: o mesmo conjunto de blocos e o mesmo
 * conversor markdown servem para o editor do dashboard e para as leituras do
 * corpo (contagem de palavras, historico e a visao crua), entao nunca discordam
 * sobre o que e markdown.
 */

import {
  BlockNoteSchema,
  createBlockSpec,
  createInlineContentSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from "@blocknote/core";

/**
 * Propriedades do bloco de audio. `duration` guarda o `{d=...}` exatamente como
 * veio no markdown, para a gravacao devolver o mesmo texto ao app.
 */
export const audioPropSchema = {
  attachmentId: { default: "" },
  duration: { default: "" },
};

/**
 * Marcador do audio no markdown, o mesmo que o app le e escreve. Sem duracao o
 * `{d=...}` e omitido, que e o formato aceito pelo parser do celular.
 */
export function audioMarker(attachmentId: string, duration: string): string {
  const seconds = duration.trim();
  return seconds
    ? `!audio[attachment:${attachmentId}]{d=${seconds}}`
    : `!audio[attachment:${attachmentId}]`;
}

/**
 * Marcador temporario do conversor.
 *
 * O bloco de audio nao tem equivalente nativo em markdown: o conversor do
 * BlockNote o descartaria. O `toExternalHTML` entrega um paragrafo com este
 * prefixo (so letras e numeros, o conversor nao escapa) e
 * `blocksToNoteMarkdown` o troca pelo `!audio[...]` na posicao certa.
 */
export const AUDIO_PLACEHOLDER = "DYARIUMAUDIO";

/** Audio dentro do documento: `!audio[attachment:<id>]{d=12.5}` no markdown. */
export const audioBlockSpec = () =>
  createBlockSpec(
    { type: "audio", propSchema: audioPropSchema, content: "none" },
    {
      render: () => ({ dom: document.createElement("div") }),
      toExternalHTML: (block: { props: Record<string, string> }) => {
        const paragraph = document.createElement("p");
        paragraph.textContent = `${AUDIO_PLACEHOLDER}${block.props.attachmentId}`;
        return { dom: paragraph };
      },
    },
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

/**
 * Referencia a outra nota (/link).
 *
 * Sem `toExternalHTML` o conversor do BlockNote descarta a mencao ao gerar o
 * markdown (foi assim que uma notaMention sumiu na conversao). Como link para
 * `note:<id>`, ela sobrevive: o app mostra como bloco opaco, somente leitura.
 */
export const noteMentionSpec = () =>
  createInlineContentSpec(
    {
      type: "noteMention",
      propSchema: { entryId: { default: "" }, title: { default: "" } },
      content: "none",
    },
    {
      render: () => ({ dom: document.createElement("span") }),
      toExternalHTML: (inline: { props: Record<string, string> }) => {
        const link = document.createElement("a");
        link.setAttribute("href", `note:${inline.props.entryId}`);
        link.textContent = inline.props.title || "nota";
        return { dom: link };
      },
    },
  );

/**
 * Estilos que a nota aceita.
 *
 * Saiam fora cor de texto, cor de fundo e sublinhado: o markdown nao sabe
 * representar nenhum dos tres, e o editor do celular nao sabe mostrar. So que
 * eles existissem aqui, o usuario marcava um texto em amarelo, salvava, e a cor
 * sumia (no celular e no markdown) sem aviso.
 */
export function createNoteStyleSchema() {
  const { underline, textColor, backgroundColor, ...portable } = defaultStyleSpecs;
  void underline;
  void textColor;
  void backgroundColor;
  return portable;
}

/**
 * Schema do conversor sem React, usado nas leituras do corpo (o editor do
 * dashboard tem o seu, com os componentes React).
 */
export function createNoteSchema() {
  return BlockNoteSchema.create({
    blockSpecs: { ...defaultBlockSpecs, audio: audioBlockSpec(), image: imageBlockSpec() },
    inlineContentSpecs: { ...defaultInlineContentSpecs, noteMention: noteMentionSpec() },
    styleSpecs: createNoteStyleSchema(),
  });
}
