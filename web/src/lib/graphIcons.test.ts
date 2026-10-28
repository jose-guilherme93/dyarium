import { describe, expect, it } from "vitest";
import { GRAPH_ICONS, KIND_ICON, iconKeyFor } from "./graphIcons";

describe("graphIcons", () => {
  it("usa o icone do tipo quando a entidade nao escolheu um", () => {
    expect(iconKeyFor("person", "")).toBe("person");
    expect(iconKeyFor("place", undefined)).toBe("home");
    expect(iconKeyFor("theme", "")).toBe("hash");
    expect(iconKeyFor("decision", "")).toBe("check");
    expect(iconKeyFor("note", "")).toBe("document");
    expect(iconKeyFor("user", "")).toBe("person");
  });

  it("o icone escolhido vence o do tipo", () => {
    expect(iconKeyFor("person", "heart")).toBe("heart");
  });

  it("ignora uma chave fora da paleta e volta para o tipo", () => {
    expect(iconKeyFor("place", "nao-existe")).toBe("home");
  });

  it("a paleta nao tem chave repetida e cobre todos os tipos", () => {
    const keys = GRAPH_ICONS.map((icon) => icon.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of Object.values(KIND_ICON)) {
      expect(keys).toContain(key);
    }
  });
});
