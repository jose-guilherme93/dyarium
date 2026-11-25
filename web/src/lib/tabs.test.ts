import { beforeEach, describe, expect, it } from "vitest";
import {
  TABS_KEY,
  activateTab,
  closeTab,
  closeTabs,
  openInNewTab,
  openTab,
  readTabs,
  reconcileTabs,
  setTabTitle,
  writeTabs,
  type TabsState,
} from "./tabs";

function estado(ids: string[], activeId: string | null = null): TabsState {
  const tabs = ids.map((id) => ({ id, title: `Nota ${id}` }));
  return { tabs, activeId: activeId ?? tabs[tabs.length - 1]?.id ?? null };
}

beforeEach(() => {
  localStorage.clear();
});

describe("abas de notas", () => {
  it("abrir cria a aba e ativa", () => {
    const aberto = openTab(estado([], null), "a", "Primeira");
    expect(aberto.tabs).toEqual([{ id: "a", title: "Primeira" }]);
    expect(aberto.activeId).toBe("a");
  });

  it("abrir de novo nao duplica e nao muda a ordem", () => {
    let atual = openTab(estado([], null), "a", "Primeira");
    atual = openTab(atual, "b", "Segunda");
    atual = openTab(atual, "a", "Primeira");
    expect(atual.tabs.map((tab) => tab.id)).toEqual(["a", "b"]);
    expect(atual.activeId).toBe("a");
  });

  it("trocar de aba so muda a ativa", () => {
    const atual = openTab(openTab(estado([], null), "a"), "b");
    const trocado = activateTab(atual, "a");
    expect(trocado.tabs.map((tab) => tab.id)).toEqual(["a", "b"]);
    expect(trocado.activeId).toBe("a");
  });

  it("fechar a aba ativa ativa a vizinha da direita, senao a da esquerda", () => {
    const tres = estado(["a", "b", "c"], "b");
    expect(closeTab(tres, "b").activeId).toBe("c");
    const duas = estado(["a", "b"], "b");
    expect(closeTab(duas, "b").activeId).toBe("a");
  });

  it("fechar uma aba que nao esta ativa mantem a ativa", () => {
    const atual = estado(["a", "b", "c"], "b");
    const fechado = closeTab(atual, "a");
    expect(fechado.tabs.map((tab) => tab.id)).toEqual(["b", "c"]);
    expect(fechado.activeId).toBe("b");
  });

  it("fechar a ultima aba volta ao inicio, sem ativa", () => {
    const fechado = closeTab(estado(["a"], "a"), "a");
    expect(fechado.tabs).toEqual([]);
    expect(fechado.activeId).toBeNull();
  });

  it("fechar varias de uma vez escolhe a vizinha da ultima fechada", () => {
    const fechado = closeTabs(estado(["a", "b", "c", "d"], "b"), ["b", "c"]);
    expect(fechado.tabs.map((tab) => tab.id)).toEqual(["a", "d"]);
    expect(fechado.activeId).toBe("d");
  });

  it("guardar o titulo nao mexe na ordem nem na ativa", () => {
    const atual = setTabTitle(estado(["a", "b"], "a"), "b", "Novo nome");
    expect(atual.tabs[1].title).toBe("Novo nome");
    expect(atual.activeId).toBe("a");
  });

  it("abrir em nova aba sem nota aberta deixa a escolhida sozinha", () => {
    const aberto = openInNewTab(estado([], null), "a", "Primeira", null);
    expect(aberto).toEqual({ tabs: [{ id: "a", title: "Primeira" }], activeId: "a" });
  });

  it("abrir em nova aba com outra nota aberta poe a aberta na frente", () => {
    const aberto = openInNewTab(estado([], null), "b", "Segunda", "a");
    expect(aberto.tabs.map((tab) => tab.id)).toEqual(["a", "b"]);
    expect(aberto.activeId).toBe("b");
  });

  it("abrir em nova aba da propria nota aberta nao duplica", () => {
    const aberto = openInNewTab(estado([], null), "a", "Primeira", "a");
    expect(aberto.tabs.map((tab) => tab.id)).toEqual(["a"]);
    expect(aberto.activeId).toBe("a");
  });

  it("com abas, abrir em nova aba acrescenta ou ativa, nunca duplica", () => {
    const duas = estado(["a", "b"], "a");
    expect(openInNewTab(duas, "c", "Terceira", "a").tabs.map((tab) => tab.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    const volta = openInNewTab(duas, "b", "Nota b", "a");
    expect(volta.tabs.map((tab) => tab.id)).toEqual(["a", "b"]);
    expect(volta.activeId).toBe("b");
  });

  it("restauracao descarta id que nao existe mais", () => {
    const restaurado = reconcileTabs(
      {
        tabs: [
          { id: "viva", title: "Viva" },
          { id: "sumiu", title: "Fantasma" },
        ],
        activeId: "sumiu",
      },
      (id) => id === "viva",
    );
    expect(restaurado.tabs.map((tab) => tab.id)).toEqual(["viva"]);
    expect(restaurado.activeId).toBe("viva");
  });
});

describe("abas no localStorage", () => {
  it("grava e le o mesmo estado", () => {
    writeTabs({ tabs: [{ id: "a", title: "Primeira" }], activeId: "a" });
    expect(readTabs()).toEqual({ tabs: [{ id: "a", title: "Primeira" }], activeId: "a" });
    expect(localStorage.getItem(TABS_KEY)).toContain('"a"');
  });

  it("sem nada guardado comeca vazio", () => {
    expect(readTabs()).toEqual({ tabs: [], activeId: null });
  });

  it("descarta valor corrompido em vez de quebrar a tela", () => {
    localStorage.setItem(TABS_KEY, "{{{");
    expect(readTabs()).toEqual({ tabs: [], activeId: null });
  });

  it("ignora ativa que nao esta entre as abas", () => {
    localStorage.setItem(
      TABS_KEY,
      JSON.stringify({ tabs: [{ id: "a", title: "Primeira" }], activeId: "outra" }),
    );
    expect(readTabs().activeId).toBe("a");
  });
});
