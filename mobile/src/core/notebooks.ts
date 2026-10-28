/**
 * Cadernos: colecoes de notas. O caderno padrao existe sempre e nao pode ser
 * renomeado nem excluido.
 */

export const DEFAULT_NOTEBOOK_ID = 'notas-ao-acaso';
export const DEFAULT_NOTEBOOK_NAME = 'Notas ao acaso';

/** Cores oferecidas ao criar/editar um caderno. Vazio = neutro. */
export const NOTEBOOK_COLORS = [
  '',
  '#C7D8F2',
  '#C9E4C5',
  '#F4D6B8',
  '#D8CCEF',
  '#F2C4C4',
  '#BFE1DF',
  '#EFE3A8',
  '#EEC7DE',
] as const;

export interface Notebook {
  id: string;
  name: string;
  color: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  /** Alteracao local ainda nao enviada ao servidor. */
  dirty?: boolean;
  /** Ainda nao existe no servidor (criado offline). */
  synced?: boolean;
}

export function notebookColor(notebook: Pick<Notebook, 'color' | 'isDefault'>): string {
  return notebook.isDefault ? '' : notebook.color;
}

/**
 * Igualdade por conteudo. O refresh do banco cria objetos novos a cada leitura;
 * sem isso, toda atualizacao trocava a identidade da lista e re-renderizava a
 * home inteira (todos os cards) sem nada ter mudado.
 */
export function sameNotebooks(a: Notebook[], b: Notebook[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (
      left.id !== right.id ||
      left.name !== right.name ||
      left.color !== right.color ||
      left.isDefault !== right.isDefault ||
      left.createdAt !== right.createdAt ||
      left.updatedAt !== right.updatedAt ||
      Boolean(left.dirty) !== Boolean(right.dirty) ||
      Boolean(left.synced) !== Boolean(right.synced)
    ) {
      return false;
    }
  }
  return true;
}

/** Ordem canonica: criacao, com o padrao sempre no fim. */
export function sortNotebooks(notebooks: Notebook[], alphabetical = false): Notebook[] {
  return [...notebooks].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? 1 : -1;
    if (alphabetical) return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
    return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  });
}
