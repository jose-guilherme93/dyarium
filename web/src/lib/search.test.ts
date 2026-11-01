import { describe, expect, it } from "vitest";
import { normalizeSearch } from "./search";

describe("normalizeSearch", () => {
  it("ignora acento e caixa", () => {
    expect(normalizeSearch("Reunião")).toBe("reuniao");
    expect(normalizeSearch("AÇÃO")).toBe("acao");
    expect(normalizeSearch(normalizeSearch("Café"))).toBe("cafe");
  });
});
