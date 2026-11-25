// Botoes de acao declarativos da nota de projeto (docs/projetos.md, secao
// "Botoes de acao"). Um botao e dado, nao codigo: o comando vem de uma lista
// fechada e cada cliente implementa a mesma semantica mapeando o comando para
// uma funcao propria. Nenhum script e executado a partir do documento.

/** Comandos validos na v1 (leitura e navegacao). */
export const NOTE_COMMANDS = ["filter-items", "copy-link"] as const;
export type NoteCommand = (typeof NOTE_COMMANDS)[number];

/** Icone do botao, por chave: o cliente desenha, o dado so nomeia. */
export const NOTE_ICONS = ["filter", "link"] as const;
export type NoteActionIcon = (typeof NOTE_ICONS)[number];

/** Periodo da aba Itens; mesmo idiom do segmento 7/30/tudo. */
export type ProjectsRange = "7" | "30" | "all";

export interface NoteAction {
  id: string;
  label: string;
  icon: NoteActionIcon;
  command: NoteCommand;
  params: Record<string, string>;
}

/** Guard da lista fechada: dado de fora (ou futuro) nao dispara handler. */
export function isNoteCommand(value: unknown): value is NoteCommand {
  return typeof value === "string" && (NOTE_COMMANDS as readonly string[]).includes(value);
}
