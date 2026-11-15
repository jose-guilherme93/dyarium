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

const GIS_SRC = "https://accounts.google.com/gsi/client";

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
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
export async function requestDriveToken(): Promise<DriveToken> {
  const clientId = googleClientId();
  if (!clientId) throw new Error("falta configurar VITE_GOOGLE_CLIENT_ID");
  await loadGis();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) throw new Error("login do Google indisponivel neste navegador");

  return new Promise<DriveToken>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        const token = response.access_token;
        if (!token) {
          reject(new Error(response.error_description || response.error || "login recusado"));
          return;
        }
        const segundos = response.expires_in ?? 3600;
        resolve({ accessToken: token, expiresAt: Date.now() + segundos * 1000 });
      },
      error_callback: (error) => reject(new Error(error.message || error.type || "login cancelado")),
    });
    client.requestAccessToken({ prompt: "" });
  });
}

/** Token ainda vale por pelo menos um minuto? */
export function tokenIsFresh(token: DriveToken | null): token is DriveToken {
  return !!token && token.expiresAt - Date.now() > 60_000;
}
