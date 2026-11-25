/**
 * Abas de notas do web.
 *
 * Nenhuma nota vira aba ao ser clicada: o clique normal abre a nota sozinha no
 * editor. Aba nasce so pelo menu da lista ("Abrir em nova aba"), e a barra so
 * aparece com duas ou mais — com uma, e so o editor. Livro e caderno de
 * projetos continuam abrindo na propria superficie, sem aba. O estado inteiro
 * (abas e a ativa) mora em localStorage para o recarregamento devolver a mesma
 * mesa de trabalho. O titulo fica junto da aba para a barra pintar antes de
 * qualquer lista carregar; quando a lista chega, o titulo e atualizado e os ids
 * que nao existem mais caem fora.
 */

export interface NoteTab {
  id: string;
  title: string;
}

export interface TabsState {
  tabs: NoteTab[];
  activeId: string | null;
}

export const TABS_KEY = "dyarium.tabs";

export const EMPTY_TABS: TabsState = { tabs: [], activeId: null };

/** A aba `index` e a vizinha da direita quando existe; senao a da esquerda. */
function vizinha(tabs: NoteTab[], index: number): string | null {
  return tabs[index]?.id ?? tabs[index - 1]?.id ?? null;
}

function normalizar(tabs: NoteTab[], activeId: string | null): TabsState {
  const existe = activeId !== null && tabs.some((tab) => tab.id === activeId);
  return { tabs, activeId: existe ? activeId : (tabs[tabs.length - 1]?.id ?? null) };
}

function lerTitulo(valor: unknown): string {
  return typeof valor === "string" ? valor : "";
}

/** Le as abas guardadas. Valor corrompido vira estado vazio, nunca excecao. */
export function readTabs(): TabsState {
  try {
    const bruto = localStorage.getItem(TABS_KEY);
    if (!bruto) return EMPTY_TABS;
    const guardado = JSON.parse(bruto) as unknown;
    if (!guardado || typeof guardado !== "object") return EMPTY_TABS;
    const dados = guardado as Record<string, unknown>;
    const lista = Array.isArray(dados.tabs) ? dados.tabs : [];
    const vistos = new Set<string>();
    const tabs: NoteTab[] = [];
    for (const item of lista) {
      if (!item || typeof item !== "object") continue;
      const tab = item as Record<string, unknown>;
      if (typeof tab.id !== "string" || !tab.id || vistos.has(tab.id)) continue;
      vistos.add(tab.id);
      tabs.push({ id: tab.id, title: lerTitulo(tab.title) });
    }
    const activeId = typeof dados.activeId === "string" ? dados.activeId : null;
    return normalizar(tabs, activeId);
  } catch {
    return EMPTY_TABS;
  }
}

export function writeTabs(state: TabsState): void {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(state));
  } catch {
    // Sem localStorage as abas valem so para esta sessao; nada se perde.
  }
}

/** Abre (ou reativa) a aba, sem duplicar e sem mudar a ordem das existentes. */
export function openTab(state: TabsState, id: string, title = ""): TabsState {
  const existe = state.tabs.find((tab) => tab.id === id);
  if (existe) {
    return {
      tabs: state.tabs.map((tab) =>
        tab.id === id ? { id, title: title || tab.title } : tab,
      ),
      activeId: id,
    };
  }
  return { tabs: [...state.tabs, { id, title }], activeId: id };
}

/**
 * "Abrir em nova aba": a unica acao que cria aba.
 *
 * Sem abas, a nota que estava aberta (quando for outra) vira a primeira e a
 * escolhida a segunda; sem nota aberta, a escolhida fica sozinha. Com abas,
 * acrescenta a escolhida ao fim, ou so ativa a que ja existe — nunca duplica.
 */
export function openInNewTab(
  state: TabsState,
  id: string,
  title = "",
  currentId: string | null = null,
): TabsState {
  if (state.tabs.length === 0 && currentId && currentId !== id) {
    return { tabs: [{ id: currentId, title: "" }, { id, title }], activeId: id };
  }
  return openTab(state, id, title);
}

export function activateTab(state: TabsState, id: string): TabsState {
  if (!state.tabs.some((tab) => tab.id === id)) return state;
  return { ...state, activeId: id };
}

export function setTabTitle(state: TabsState, id: string, title: string): TabsState {
  if (!title) return state;
  if (!state.tabs.some((tab) => tab.id === id && tab.title !== title)) return state;
  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, title } : tab)),
  };
}

/**
 * Fecha uma aba. Fechando a ativa, quem assume e a vizinha da direita; sem
 * direita, a da esquerda; sem nenhuma, o inicio (sem ativa).
 */
export function closeTab(state: TabsState, id: string): TabsState {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== id);
  if (state.activeId !== id) return { tabs, activeId: state.activeId };
  return { tabs, activeId: vizinha(tabs, index) };
}

/** Fecha varias de uma vez (nota apagada, arquivada ou apagada em lote). */
export function closeTabs(state: TabsState, ids: string[]): TabsState {
  let atual = state;
  for (const id of ids) {
    const aberta = atual.tabs.find((tab) => tab.id === id);
    if (!aberta) continue;
    // A vizinha e recalculada a cada fechamento, como se fossem cliques.
    const index = atual.tabs.findIndex((tab) => tab.id === id);
    const tabs = atual.tabs.filter((tab) => tab.id !== id);
    atual = {
      tabs,
      activeId:
        atual.activeId === id ? vizinha(tabs, index) : atual.activeId,
    };
  }
  return atual;
}

/**
 * Descarta as abas que nao existem mais, na primeira lista carregada depois de
 * abrir o app. A ativa invalida cede o lugar para a vizinha da direita; sem
 * vizinha, a da esquerda; sem abas, o inicio.
 */
export function reconcileTabs(
  state: TabsState,
  existe: (id: string) => boolean,
): TabsState {
  const invalidas = state.tabs.filter((tab) => !existe(tab.id));
  return closeTabs(state, invalidas.map((tab) => tab.id));
}
