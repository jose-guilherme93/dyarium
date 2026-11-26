/**
 * Login do Google para o Drive, pelo modelo de token do GIS.
 *
 * Nao existe troca de codigo no servidor: o navegador recebe um access token de
 * cerca de uma hora e o guarda so em memoria. Sem refresh token guardado, nao
 * ha credencial em disco para vazar; quando o token vence, a tela pede de novo.
 *
 * O client id e publico por natureza (vai no bundle). O que nao pode faltar e
 * ele estar configurado em `VITE_GOOGLE_CLIENT_ID`.
 */

import { DRIVE_SCOPE } from "./drive";

/** Escopos pedidos ao Google: identidade (nome, e-mail, foto) + acesso ao Drive. */
export const WEB_GOOGLE_SCOPES = `openid email profile ${DRIVE_SCOPE}`;

const GIS_SRC = "https://accounts.google.com/gsi/client";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
/** Estado do redirect no sessionStorage: some assim que o Google responde. */
export const DRIVE_REDIRECT_STATE_KEY = "dyarium.drive.redirect";
/** O usuario desmarcou o acesso ao Drive; o proximo login pede o consentimento. */
export const DRIVE_SCOPE_DENIED_KEY = "dyarium.drive.scope.negado";

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  /** Escopos concedidos, separados por espaco. */
  scope?: string;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void;
}

interface GoogleAccounts {
  accounts?: {
    oauth2?: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        callback: (response: TokenResponse) => void;
        error_callback?: (error: { message?: string; type?: string }) => void;
      }) => TokenClient;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleAccounts;
  }
}

export interface DriveToken {
  accessToken: string;
  /** Epoch em ms. */
  expiresAt: number;
  /** Escopos concedidos; ausente quando o Google nao devolve `scope`. */
  scope?: string;
}

export interface DriveTokenOptions {
  /** Pedido sem tela: `prompt: "none"`. */
  silent?: boolean;
  /** Login interativo pela aba inteira (redirect), sem janela do Google. */
  redirect?: boolean;
  /** Sobrepoe o prompt do Google, para o consentimento de identidade. */
  prompt?: string;
  /** Prazo do pedido, em ms. O silencioso automatico usa um curto. */
  timeoutMs?: number;
}

let carregando: Promise<void> | null = null;

export function googleClientId(): string {
  return (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? "";
}

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  carregando ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      carregando = null;
      reject(new Error("nao foi possivel carregar o login do Google"));
    };
    document.head.appendChild(script);
  });
  return carregando;
}

/**
 * Pede o token do Drive. Precisa de um gesto do usuario (clique): o navegador
 * bloqueia a janela do Google aberta por script.
 */
export async function requestDriveToken(options?: DriveTokenOptions): Promise<DriveToken> {
  const clientId = googleClientId();
  if (!clientId) throw new Error("falta configurar VITE_GOOGLE_CLIENT_ID");
  await loadGis();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) throw new Error("login do Google indisponivel neste navegador");

  return new Promise<DriveToken>((resolve, reject) => {
    let encerrado = false;
    // Janela fechada ou bloqueada nao chama nem o callback nem o error_callback.
    // Sem prazo, a tela ficaria "conectando" para sempre; com prazo, o erro
    // aparece e o usuario tenta de novo.
    const prazo = setTimeout(() => {
      if (encerrado) return;
      encerrado = true;
      reject(new Error("o login do Google nao respondeu; a janela foi bloqueada ou fechada"));
    }, options?.timeoutMs ?? 120_000);
    const encerrar = (): void => {
      encerrado = true;
      clearTimeout(prazo);
    };
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: WEB_GOOGLE_SCOPES,
      callback: (response) => {
        if (encerrado) return;
        encerrar();
        const token = response.access_token;
        if (!token) {
          reject(new Error(response.error_description || response.error || "login recusado"));
          return;
        }
        const segundos = response.expires_in ?? 3600;
        resolve({
          accessToken: token,
          expiresAt: Date.now() + segundos * 1000,
          scope: typeof response.scope === "string" ? response.scope : undefined,
        });
      },
      error_callback: (error) => {
        if (encerrado) return;
        encerrar();
        reject(new Error(error.message || error.type || "login cancelado"));
      },
    });
    client.requestAccessToken({
      prompt: options?.prompt ?? (options?.silent ? "none" : ""),
    });
  });
}

/** Token ainda vale por pelo menos um minuto? */
export function tokenIsFresh(token: DriveToken | null): token is DriveToken {
  return !!token && token.expiresAt - Date.now() > 60_000;
}

/**
 * Carrega o script do GIS antes do clique.
 *
 * O navegador so abre a janela do Google dentro do gesto do usuario. Baixar o
 * script no clique gasta esse gesto numa requisicao de rede e o popup pode ser
 * bloqueado — a janela nao aparece e o callback nunca chega, que na tela parece
 * "nada aconteceu". Carregando antes, o clique chega ao `requestAccessToken`
 * ainda dentro do gesto.
 */
export function preloadGoogle(): Promise<void> {
  if (!googleClientId()) return Promise.resolve();
  return loadGis().catch(() => undefined);
}

export interface DriveRedirectReturn {
  token: DriveToken;
}

/**
 * Login sem janela: manda a aba para o Google e volta com o token no fragmento
 * da URL. O `state` fica no sessionStorage e precisa bater no retorno, para
 * uma pagina de terceiro nao empurrar um token qualquer.
 */
export function startDriveLogin(): void {
  const clientId = googleClientId();
  if (!clientId) throw new Error("falta configurar VITE_GOOGLE_CLIENT_ID");
  const state = randomState();
  let negado = false;
  try {
    negado = sessionStorage.getItem(DRIVE_SCOPE_DENIED_KEY) === "1";
    sessionStorage.removeItem(DRIVE_SCOPE_DENIED_KEY);
    sessionStorage.setItem(DRIVE_REDIRECT_STATE_KEY, state);
  } catch {
    // Sem sessionStorage o state nao sobrevive ao redirect; o Google recusa
    // pela conferencia abaixo e o usuario tenta de novo numa janela normal.
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "token",
    scope: WEB_GOOGLE_SCOPES,
    include_granted_scopes: "true",
    state,
    // Se o usuario desmarcou o Drive, o Google so mostra o checkbox de novo
    // com consentimento forcado.
    prompt: negado ? "consent select_account" : "select_account",
  });
  window.location.assign(`${AUTH_ENDPOINT}?${params.toString()}`);
}

/**
 * Le o retorno do redirect, se houver. Limpa o fragmento antes de qualquer
 * outro codigo rodar para o token nao ficar na barra de endereco nem no
 * historico. Devolve null quando a URL nao e um retorno do Google.
 */
export function consumeDriveRedirect(): DriveRedirectReturn | null {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const accessToken = params.get("access_token");
  const error = params.get("error");
  if (!accessToken && !error) return null;

  // O token nunca fica na URL: sai do historico antes de qualquer render.
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}`,
  );

  if (error) {
    throw new Error(params.get("error_description") || error);
  }
  if (!accessToken) return null;

  let guardado: string | null;
  try {
    guardado = sessionStorage.getItem(DRIVE_REDIRECT_STATE_KEY);
    sessionStorage.removeItem(DRIVE_REDIRECT_STATE_KEY);
  } catch {
    guardado = null;
  }
  const state = params.get("state");
  if (!guardado || state !== guardado) {
    throw new Error("o retorno do login nao confere; tente de novo");
  }

  const segundos = Number(params.get("expires_in"));
  return {
    token: {
      accessToken,
      expiresAt: Date.now() + (Number.isFinite(segundos) ? segundos : 3600) * 1000,
      scope: params.get("scope") ?? undefined,
    },
  };
}

function redirectUri(): string {
  // Tem que ser identico ao cadastrado em Authorized redirect URIs.
  return `${window.location.origin}/`;
}

function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

