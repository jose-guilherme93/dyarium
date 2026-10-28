import { describe, expect, it } from "vitest";
import { exportYear, parseNotionDateElement, parseNotionDateText, toRecordedAt } from "./notionDates";

function local(year: number, month: number, day: number, hour = 12, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute, 0);
}

describe("parseNotionDateText", () => {
  it("le a data em portugues com hora, como o Notion exporta", () => {
    const value = parseNotionDateText("17 de novembro de 2025 15:57", 2026);
    expect(value?.date).toEqual(local(2025, 11, 17, 15, 57));
    expect(value?.hadYear).toBe(true);
    expect(value?.hasTime).toBe(true);
  });

  it("le a data em ingles com AM/PM", () => {
    const value = parseNotionDateText("September 19, 2025 10:34 AM", 2026);
    expect(value?.date).toEqual(local(2025, 9, 19, 10, 34));
  });

  it("preserva o ano do texto, nao o ano da importacao", () => {
    const value = parseNotionDateText("3 de marco de 2021", 2026);
    expect(value?.date).toEqual(local(2021, 3, 3));
    expect(value?.hadYear).toBe(true);
  });

  it("data sem ano usa o ano da exportacao", () => {
    const value = parseNotionDateText("17 de novembro 15:57", 2024);
    expect(value?.date).toEqual(local(2024, 11, 17, 15, 57));
    expect(value?.hadYear).toBe(false);
  });

  it("le datas numericas no formato brasileiro", () => {
    expect(parseNotionDateText("17/11/2025", 2026)?.date).toEqual(local(2025, 11, 17));
    // Quando o segundo numero passa de 12, a ordem e mes/dia.
    expect(parseNotionDateText("11/17/2025", 2026)?.date).toEqual(local(2025, 11, 17));
  });

  it("le ISO com e sem fuso", () => {
    expect(parseNotionDateText("2025-11-17T15:57", 2026)?.date).toEqual(local(2025, 11, 17, 15, 57));
    expect(parseNotionDateText("2025-11-17T15:57:00Z", 2026)?.date.toISOString()).toBe("2025-11-17T15:57:00.000Z");
  });

  it("um intervalo usa a data inicial", () => {
    const value = parseNotionDateText("March 1, 2024 → March 5, 2024", 2026);
    expect(value?.date).toEqual(local(2024, 3, 1));
  });

  it("devolve null quando nao da para ler", () => {
    expect(parseNotionDateText("31 de fevereiro de 2025", 2026)).toBeNull();
    expect(parseNotionDateText("nao e uma data", 2026)).toBeNull();
  });
});

describe("parseNotionDateElement", () => {
  it("prefere o atributo datetime ao texto visivel", () => {
    const time = document.createElement("time");
    time.setAttribute("datetime", "2025-11-17T15:57");
    time.textContent = "17 de novembro de 2025 15:57";
    expect(parseNotionDateElement(time, 2026)?.date).toEqual(local(2025, 11, 17, 15, 57));
  });

  it("cai no texto quando o datetime nao existe", () => {
    const time = document.createElement("time");
    time.textContent = "@17 de novembro de 2025 15:57";
    expect(parseNotionDateElement(time, 2026)?.date).toEqual(local(2025, 11, 17, 15, 57));
  });
});

describe("utilitarios", () => {
  it("exportYear ignora a data epoch do zip", () => {
    expect(exportYear(new Date(1980, 0, 1))).toBeGreaterThan(1980);
    expect(exportYear(new Date(2024, 4, 1))).toBe(2024);
  });

  it("toRecordedAt devolve RFC 3339 em UTC", () => {
    const value = parseNotionDateText("17 de novembro de 2025 15:57", 2026);
    expect(toRecordedAt(value)).toBe(value!.date.toISOString());
  });
});
