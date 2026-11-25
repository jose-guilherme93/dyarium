import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { preloadGoogle, requestDriveToken, tokenIsFresh } from "./google";

interface TokenConfig {
  scope: string;
  callback: (response: { access_token?: string; expires_in?: number; error?: string }) => void;
  error_callback: (error: { message?: string; type?: string }) => void;
}

/**
 * GIS de mentira: guarda a configuracao que o app montou e nao abre janela.
 * O teste decide quando (e se) o Google responde.
 */
function installGis(): { config: () => TokenConfig; prompts: () => string[] } {
  let guardada: TokenConfig | null = null;
  const pedidos: string[] = [];
  (window as unknown as { google: unknown }).google = {
    accounts: {
      oauth2: {
        initTokenClient: (config: TokenConfig) => {
          guardada = config;
          return {
            requestAccessToken: (options?: { prompt?: string }) => {
              pedidos.push(options?.prompt ?? "(sem prompt)");
            },
          };
        },
      },
    },
  };
  return {
    config: () => {
      if (!guardada) throw new Error("o app nao iniciou o cliente do GIS");
      return guardada;
    },
    prompts: () => pedidos,
  };
}

beforeEach(() => {
  vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "client-de-teste.apps.googleusercontent.com");
});

/** O app so chama initTokenClient depois de carregar o GIS, num microtask. */
async function aguardarConfig(gis: { config: () => TokenConfig }): Promise<TokenConfig> {
  for (let tentativa = 0; tentativa < 20; tentativa += 1) {
    try {
      return gis.config();
    } catch {
      await Promise.resolve();
    }
  }
  throw new Error("o app nao iniciou o cliente do GIS");
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  delete (window as unknown as { google?: unknown }).google;
});

describe("login do Drive", () => {
  it("sem client id nem carrega o GIS e recusa com mensagem propria", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "");
    await expect(preloadGoogle()).resolves.toBeUndefined();
    await expect(requestDriveToken()).rejects.toThrow(/VITE_GOOGLE_CLIENT_ID/);
  });

  it("responde com o token e a validade quando o Google chama o callback", async () => {
    const gis = installGis();
    const pedido = requestDriveToken();
    const config = await aguardarConfig(gis);
    config.callback({ access_token: "token-do-drive", expires_in: 3600 });
    await expect(pedido).resolves.toEqual({
      accessToken: "token-do-drive",
      expiresAt: expect.any(Number),
    });
  });

  it("erro do Google (janela bloqueada) vira rejeicao, nao espera eterna", async () => {
    const gis = installGis();
    const pedido = requestDriveToken();
    const config = await aguardarConfig(gis);
    config.error_callback({ type: "popup_failed_to_open" });
    await expect(pedido).rejects.toThrow(/popup_failed_to_open/);
  });

  it("janela que nunca responde vira erro depois do prazo, em vez de girar para sempre", async () => {
    vi.useFakeTimers();
    const gis = installGis();
    const pedido = requestDriveToken();
    await aguardarConfig(gis);
    vi.advanceTimersByTime(120_000);
    await expect(pedido).rejects.toThrow(/nao respondeu/);
  });

  it("token vencido nao conta como fresco", () => {
    expect(tokenIsFresh({ accessToken: "x", expiresAt: Date.now() + 30_000 })).toBe(false);
    expect(tokenIsFresh({ accessToken: "x", expiresAt: Date.now() + 600_000 })).toBe(true);
    expect(tokenIsFresh(null)).toBe(false);
  });

  it("pedido normal deixa o Google decidir a tela (prompt vazio)", async () => {
    const gis = installGis();
    const pedido = requestDriveToken();
    await aguardarConfig(gis);
    expect(gis.prompts()).toEqual([""]);
    gis.config().callback({ access_token: "t", expires_in: 3600 });
    await pedido;
  });

  it("pedido silencioso usa prompt none e nao abre tela", async () => {
    const gis = installGis();
    const pedido = requestDriveToken({ silent: true });
    await aguardarConfig(gis);
    expect(gis.prompts()).toEqual(["none"]);
    gis.config().callback({ access_token: "t", expires_in: 3600 });
    await pedido;
  });

  it("pede identidade e Drive no mesmo consentimento", async () => {
    const gis = installGis();
    const pedido = requestDriveToken();
    const config = await aguardarConfig(gis);
    expect(config.scope).toContain("openid");
    expect(config.scope).toContain("email");
    expect(config.scope).toContain("profile");
    expect(config.scope).toContain("drive.file");
    config.callback({ access_token: "t", expires_in: 3600 });
    await pedido;
  });
});
