/**
 * Estado de UI de uma nota que precisa sobreviver a desmontagem do editor.
 *
 * O dashboard desmonta a nota ao trocar de tela (e ao trocar de nota) para nao
 * manter varios editores ProseMirror vivos. Sem isso, voltar para uma nota
 * perdia scroll, painel de propriedades, modo markdown e transcricoes
 * expandidas, e o usuario tinha a impressao de que "tudo recarregou".
 */

export interface NoteViewState {
  scrollTop: number;
  asideOpen: boolean;
  rawOpen: boolean;
  /** Ids dos audios com a transcricao expandida. */
  expandedAudios: string[];
  /** Posicao de reproducao por audio, em segundos. */
  audioTimes: Record<string, number>;
}

const EMPTY: NoteViewState = {
  scrollTop: 0,
  asideOpen: false,
  rawOpen: false,
  expandedAudios: [],
  audioTimes: {},
};

const states = new Map<string, NoteViewState>();

export function readNoteViewState(entryId: string): NoteViewState {
  return states.get(entryId) ?? EMPTY;
}

export function patchNoteViewState(entryId: string, patch: Partial<NoteViewState>): void {
  const current = states.get(entryId) ?? EMPTY;
  states.set(entryId, { ...current, ...patch });
}

export function rememberAudioTime(entryId: string, audioId: string, seconds: number): void {
  const current = states.get(entryId) ?? EMPTY;
  current.audioTimes = { ...current.audioTimes, [audioId]: seconds };
  states.set(entryId, current);
}
