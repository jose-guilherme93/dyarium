import { describe, expect, it } from "vitest";
import { formatBytes, formatRelativeTime, formatShortDate } from "./format";

describe("formatBytes", () => {
  it("mostra bytes, KB e MB sem casas desnecessarias", () => {
    expect(formatBytes(0)).toBe("0 bytes");
    expect(formatBytes(512)).toBe("512 bytes");
    expect(formatBytes(96961)).toBe("95 KB");
    expect(formatBytes(2.5 * 1024 * 1024)).toBe("2,5 MB");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25 MB");
  });

  it("passa para GB quando o cofre cresce", () => {
    expect(formatBytes(1.2 * 1024 * 1024 * 1024)).toBe("1,2 GB");
    expect(formatBytes(40 * 1024 * 1024 * 1024)).toBe("40 GB");
  });

  it("não inventa numero para valor invalido", () => {
    expect(formatBytes(Number.NaN)).toBe("0 bytes");
    expect(formatBytes(-4)).toBe("0 bytes");
  });
});

describe("formatShortDate", () => {
  it("mostra dia e mes curtos, sem o ano corrente", () => {
    const noon = new Date(new Date().getFullYear(), 9, 19, 12, 0, 0).toISOString();
    expect(formatShortDate(noon)).toBe("19 out");
  });

  it("inclui o ano quando a nota nao e deste ano", () => {
    expect(formatShortDate("2019-10-19T12:00:00")).toBe("19 out 2019");
  });

  it("nao inventa data para valor invalido", () => {
    expect(formatShortDate("")).toBe("");
    expect(formatShortDate("nao-e-data")).toBe("");
  });
});

describe("formatRelativeTime", () => {
  const agora = new Date("2026-11-24T12:00:00Z").getTime();

  function ha(ms: number): string {
    return new Date(agora - ms).toISOString();
  }

  it("conta em minutos, horas e dias como a linha do envio", () => {
    expect(formatRelativeTime(ha(20 * 1000), agora)).toBe("agora");
    expect(formatRelativeTime(ha(4 * 60 * 1000), agora)).toBe("há 4 min");
    expect(formatRelativeTime(ha(3 * 60 * 60 * 1000), agora)).toBe("há 3 h");
    expect(formatRelativeTime(ha(2 * 24 * 60 * 60 * 1000), agora)).toBe("há 2 d");
  });

  it("sem data ou data invalida nao inventa tempo", () => {
    expect(formatRelativeTime(null, agora)).toBe("");
    expect(formatRelativeTime("nao-e-data", agora)).toBe("");
    expect(formatRelativeTime(ha(-60 * 1000), agora)).toBe("agora");
  });
});
