import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/react";
import { storeGet, storeSet } from "./idb";

vi.mock("@sentry/react", () => ({
  init: vi.fn(),
  close: vi.fn(() => Promise.resolve(true)),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  browserTracingIntegration: vi.fn(() => ({ name: "BrowserTracing" })),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  metrics: { count: vi.fn(), distribution: vi.fn() },
}));

vi.mock("./idb", () => ({
  STORE_SETTINGS: "settings",
  storeGet: vi.fn(),
  storeSet: vi.fn(() => Promise.resolve()),
}));

const DSN = "https://public@sentry.example/1";

async function carregar() {
  vi.resetModules();
  return import("./telemetry");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VITE_SENTRY_DSN", DSN);
  vi.mocked(storeGet).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  window.history.replaceState(null, "", "/");
});

describe("telemetria do dashboard", () => {
  it("nao inicia sem DSN configurada", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "");
    const telemetry = await carregar();
    expect(telemetry.telemetryConfigured()).toBe(false);
    await telemetry.initTelemetry();
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it("inicia quando ha DSN e o dono nao desligou", async () => {
    const telemetry = await carregar();
    await telemetry.initTelemetry();
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    const opcoes = vi.mocked(Sentry.init).mock.calls[0][0]!;
    expect(opcoes.dsn).toBe(DSN);
    expect(opcoes.dataCollection).toMatchObject({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    });
    expect(opcoes.tracesSampleRate).toBe(1);
    expect(opcoes.maxBreadcrumbs).toBe(0);
    // Erro de dev nao se mistura com o de producao no painel.
    expect(opcoes.environment).toBe("development");
    // Versao do pacote no release: sem ela o painel nao separa builds.
    expect(String(opcoes.release)).toMatch(/^dyarium-web@/);
    // Rastreamento de performance (pageload, navegacao, fetch).
    expect(opcoes.integrations?.length).toBe(1);
    expect(opcoes.beforeBreadcrumb?.({} as never)).toBeNull();
  });

  it("respeita a opcao desligada guardada no navegador", async () => {
    vi.mocked(storeGet).mockResolvedValue("0" as never);
    const telemetry = await carregar();
    await telemetry.initTelemetry();
    expect(telemetry.telemetryEnabled()).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it("tira usuario e request do evento enviado", async () => {
    const telemetry = await carregar();
    await telemetry.initTelemetry();
    const opcoes = vi.mocked(Sentry.init).mock.calls[0][0]!;
    const evento = {
      user: { id: "1" },
      request: { url: "https://exemplo" },
      message: "erro",
    } as never;
    expect(opcoes.beforeSend?.(evento, {} as never)).toEqual({ message: "erro" });
  });

  it("desligar fecha o cliente e guarda a escolha", async () => {
    const telemetry = await carregar();
    await telemetry.initTelemetry();
    await telemetry.setTelemetryEnabled(false);
    expect(storeSet).toHaveBeenCalledWith("settings", "diagnostics", "0");
    expect(Sentry.close).toHaveBeenCalled();
  });

  it("avisa no painel quando a rota nao existe", async () => {
    window.history.replaceState(null, "", "/nao-existe");
    const telemetry = await carregar();
    telemetry.reportUnknownRoute();
    expect(Sentry.captureMessage).toHaveBeenCalledWith("rota inexistente: /nao-existe", "warning");
  });

  it("nao avisa em rota conhecida", async () => {
    window.history.replaceState(null, "", "/lab");
    const telemetry = await carregar();
    telemetry.reportUnknownRoute();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("conta a troca de tela", async () => {
    const telemetry = await carregar();
    await telemetry.initTelemetry();
    telemetry.trackView("map");
    expect(Sentry.logger.info).toHaveBeenCalledWith("view", { view: "map" });
    expect(Sentry.metrics.count).toHaveBeenCalledWith("app.view", 1, { attributes: { view: "map" } });
  });

  it("guarda a primeira tela antes do SDK iniciar", async () => {
    const telemetry = await carregar();
    telemetry.trackView("notes");
    expect(Sentry.logger.info).not.toHaveBeenCalled();
    await telemetry.initTelemetry();
    expect(Sentry.logger.info).toHaveBeenCalledWith("view", { view: "notes" });
  });
});
