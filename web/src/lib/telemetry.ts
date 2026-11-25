/**
 * Diagnostico anonimo do dashboard.
 *
 * Mesmo contrato do app: erro com pilha, versao e navegador bastam para
 * consertar producao. Alem de erro, o painel mede performance (pageload,
 * navegacao e fetch) e recebe log tecnico — nunca conteudo de nota, usuario,
 * cookie, header ou corpo de requisicao.
 *
 * Sem `VITE_SENTRY_DSN` o SDK nao inicia e nada sai do navegador. A opcao
 * "Enviar diagnostico" desliga tudo.
 */

import * as Sentry from "@sentry/react";

import { STORE_SETTINGS, storeGet, storeSet } from "./idb";

/** Chave em `STORE_SETTINGS`: "1" ligado (padrao), "0" desligado. */
const CHAVE = "diagnostics";

function dsn(): string {
  return (import.meta.env.VITE_SENTRY_DSN ?? "").trim();
}

let enabled = true;
let started = false;

/** Ha projeto Sentry configurado neste build? */
export function telemetryConfigured(): boolean {
  return dsn().length > 0;
}

/** Le a opcao salva, sem iniciar nada. */
export async function readTelemetryEnabled(): Promise<boolean> {
  const stored = await storeGet<string>(STORE_SETTINGS, CHAVE).catch(() => undefined);
  enabled = stored !== "0";
  return enabled;
}

/** A opcao do usuario; aplicada no inicio e no interruptor das configuracoes. */
export async function initTelemetry(): Promise<void> {
  await readTelemetryEnabled();
  const projectDsn = dsn();
  if (!enabled || !projectDsn || started) return;

  Sentry.init({
    dsn: projectDsn,
    // Erro de desenvolvimento nao se mistura com o de producao no painel.
    environment: import.meta.env.PROD ? "production" : "development",
    release: `dyarium-web@${__APP_VERSION__}`,
    // Performance: pageload, navegacao e fetch viram spans. Em producao a
    // amostra e parcial para nao pesar no plano.
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1,
    // Contraparte do `sendDefaultPii: false` no SDK 11: nada de usuario,
    // cookie, header, corpo ou variavel local sai do navegador.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    },
    attachStacktrace: true,
    maxBreadcrumbs: 0,
    debug: false,
    beforeBreadcrumb: () => null,
    beforeSend(event) {
      if (!enabled) return null;
      // O evento nao carrega quem e o dono. `request` pode ter URL de anexo;
      // o detalhe util (stack, versao, navegador) fica.
      if (event.user) delete event.user;
      if (event.request) delete event.request;
      return event;
    },
  });
  started = true;
  if (pendingView) {
    logView(pendingView);
    pendingView = null;
  }
}

/** Liga/desliga o envio. Desligar fecha o cliente desta execucao. */
export async function setTelemetryEnabled(next: boolean): Promise<void> {
  enabled = next;
  await storeSet(STORE_SETTINGS, CHAVE, next ? "1" : "0");
  if (!next) {
    started = false;
    await Sentry.close().catch(() => undefined);
    return;
  }
  if (!started) await initTelemetry();
}

export function telemetryEnabled(): boolean {
  return enabled;
}

/** Caminhos que o app atende; qualquer outro e rota inexistente. */
const ROTAS = new Set(["/", "/lab", "/admin", "/privacidade"]);

/**
 * Avisa no painel quando a URL nao existe.
 *
 * O app e SPA: ele troca de tela por estado e normaliza a URL, entao uma rota
 * invalida nao gera erro nenhum sozinha. Sem este aviso, 404 passa calado.
 */
export function reportUnknownRoute(path: string = window.location.pathname): void {
  if (ROTAS.has(path)) return;
  Sentry.captureMessage(`rota inexistente: ${path}`, "warning");
}

/** Log + metrica de uma troca de tela; o nome da tela e tecnico, sem conteudo. */
export function trackView(view: string): void {
  if (!started) {
    // A primeira tela pode ser registrada antes do SDK iniciar (init e async).
    pendingView = view;
    return;
  }
  logView(view);
}

let pendingView: string | null = null;

function logView(view: string): void {
  Sentry.logger.info("view", { view });
  Sentry.metrics.count("app.view", 1, { attributes: { view } });
}
