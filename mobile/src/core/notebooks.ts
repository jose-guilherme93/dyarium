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

/** Estado editorial de um livro. */
export type BookStatus = 'drafting' | 'revising' | 'done';

export interface Notebook {
  id: string;
  name: string;
  color: string;
  isDefault: boolean;
  /** `book` e o caderno de um livro; `mcp` e o caderno automatico de projetos; o sync continua guardando. */
  kind?: 'notes' | 'book' | 'mcp';
  createdAt: string;
  updatedAt: string;
  /** Alteracao local ainda nao enviada ao servidor. */
  dirty?: boolean;
  /** Ainda nao existe no servidor (criado offline). */
  synced?: boolean;
  /* Metadados do livro. Vazios num caderno comum. */
  subtitle?: string;
  author?: string;
  synopsis?: string;
  language?: string;
  goalWords?: number;
  bookStatus?: BookStatus;
  pageSize?: string;
  pageMarginMm?: number;
  bodyPx?: number;
  bodyLeading?: number;
  bodyFont?: string;
  dailyGoalWords?: number;
  deadline?: string;
  hasCover?: boolean;
  coverUpdatedAt?: string;
}

/** Normaliza o estado do livro; valor desconhecido cai no rascunho. */
export function normalizeBookStatus(value?: string): BookStatus {
  return value === 'revising' || value === 'done' ? value : 'drafting';
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
      left.kind !== right.kind ||
      left.createdAt !== right.createdAt ||
      left.updatedAt !== right.updatedAt ||
      Boolean(left.dirty) !== Boolean(right.dirty) ||
      Boolean(left.synced) !== Boolean(right.synced) ||
      (left.subtitle ?? '') !== (right.subtitle ?? '') ||
      (left.author ?? '') !== (right.author ?? '') ||
      (left.synopsis ?? '') !== (right.synopsis ?? '') ||
      (left.language ?? '') !== (right.language ?? '') ||
      (left.goalWords ?? 0) !== (right.goalWords ?? 0) ||
      (left.bookStatus ?? 'drafting') !== (right.bookStatus ?? 'drafting') ||
      (left.pageSize ?? '') !== (right.pageSize ?? '') ||
      (left.pageMarginMm ?? 0) !== (right.pageMarginMm ?? 0) ||
      (left.bodyPx ?? 0) !== (right.bodyPx ?? 0) ||
      (left.bodyLeading ?? 0) !== (right.bodyLeading ?? 0) ||
      (left.bodyFont ?? '') !== (right.bodyFont ?? '') ||
      (left.dailyGoalWords ?? 0) !== (right.dailyGoalWords ?? 0) ||
      (left.deadline ?? '') !== (right.deadline ?? '') ||
      Boolean(left.hasCover) !== Boolean(right.hasCover) ||
      (left.coverUpdatedAt ?? '') !== (right.coverUpdatedAt ?? '')
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Cadernos que a lista de notas mostra. Livros ficam de fora; a tela de livros
 * usa `bookNotebooks`.
 */
export function noteNotebooks(notebooks: Notebook[]): Notebook[] {
  return notebooks.filter((notebook) => notebook.kind !== 'book');
}

/** Livros vivos, para a tela de livros. */
export function bookNotebooks(notebooks: Notebook[]): Notebook[] {
  return notebooks.filter((notebook) => notebook.kind === 'book');
}

/** Ids dos livros, para tirar as notas deles das metricas e da biblioteca. */
export function bookNotebookIds(notebooks: Notebook[]): Set<string> {
  return new Set(
    notebooks.filter((notebook) => notebook.kind === 'book').map((notebook) => notebook.id),
  );
}

/** Ordem canonica: criacao, com o padrao sempre no fim. */
export function sortNotebooks(notebooks: Notebook[], alphabetical = false): Notebook[] {
  return [...notebooks].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? 1 : -1;
    if (alphabetical) return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
    return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  });
}
