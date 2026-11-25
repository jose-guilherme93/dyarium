import { describe, expect, it, vi } from "vitest";

import { diagnoseSource } from "./diagnose";

const PAGINA = "https://dyarium.jose-guilherme93.workers.dev/";

describe("diagnostico do endereco de importacao", () => {
  it("aceita quando o servidor responde e libera a leitura", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    await expect(diagnoseSource("https://diario.exemplo", { pageHref: PAGINA, fetchImpl })).resolves.toEqual({
      ok: true,
    });
    expect(String((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0])).toBe(
      "https://diario.exemplo/healthz",
    );
  });

  it("recusa endereco invalido", async () => {
    const resultado = await diagnoseSource("   ", { pageHref: PAGINA });
    expect(resultado).toMatchObject({ ok: false, reason: "address" });
  });

  it("recusa http em pagina https (mixed content)", async () => {
    const resultado = await diagnoseSource("http://192.168.0.5:8080", { pageHref: PAGINA });
    expect(resultado).toMatchObject({ ok: false, reason: "mixed" });
  });

  it("aceita http quando o destino e loopback", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    await expect(
      diagnoseSource("http://127.0.0.1:8080", { pageHref: PAGINA, fetchImpl }),
    ).resolves.toEqual({ ok: true });
  });

  it("distingue CORS fechado de servidor fora do ar", async () => {
    const cors = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.mode === "no-cors") return new Response(null, { status: 200 });
      throw new TypeError("NetworkError");
    }) as unknown as typeof fetch;
    const fechado = await diagnoseSource("https://diario.exemplo", { pageHref: PAGINA, fetchImpl: cors });
    expect(fechado).toMatchObject({ ok: false, reason: "cors", origin: "https://dyarium.jose-guilherme93.workers.dev" });

    const morto = vi.fn(async () => {
      throw new TypeError("NetworkError");
    }) as unknown as typeof fetch;
    const fora = await diagnoseSource("https://diario.exemplo", { pageHref: PAGINA, fetchImpl: morto });
    expect(fora).toMatchObject({ ok: false, reason: "unreachable" });
  });
});
