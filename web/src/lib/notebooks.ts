/** Cadernos: o padrao existe sempre e não pode ser renomeado nem excluido. */
export const DEFAULT_NOTEBOOK_ID = "notas-ao-acaso";
export const DEFAULT_NOTEBOOK_NAME = "Notas ao acaso";

/**
 * Escopo "todos os cadernos" do seletor. Não e um caderno do servidor: e o
 * valor local que a lista usa para mostrar a biblioteca inteira.
 */
export const ALL_NOTEBOOKS = "__all__";

export const NOTEBOOK_COLORS = [
  "",
  "#C7D8F2",
  "#C9E4C5",
  "#F4D6B8",
  "#D8CCEF",
  "#F2C4C4",
  "#BFE1DF",
  "#EFE3A8",
  "#EEC7DE",
] as const;
