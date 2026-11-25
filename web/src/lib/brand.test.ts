import { describe, expect, it } from "vitest";

import { brandFor, iconHref } from "./brand";

describe("brandFor", () => {
  it("assina com o nome do produto no build publicado", () => {
    expect(brandFor(false)).toEqual({ name: "dyarium", dev: false });
  });

  it("marca o build de desenvolvimento com sufixo", () => {
    expect(brandFor(true)).toEqual({ name: "dyarium - dev", dev: true });
  });

  it("troca o icone da aba no build de desenvolvimento", () => {
    expect(iconHref(false)).toBe("/favicon.svg");
    expect(iconHref(true)).toBe("/favicon-dev.svg");
  });
});
