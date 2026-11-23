/**
 * Sessao do Google Drive no navegador.
 *
 * O access token vive SO na memoria deste modulo: nada de localStorage,
 * IndexedDB ou cookie. Sem refresh token guardado, nao ha credencial em disco
 * para vazar; quando o token vence, o estado vira "expired" e a tela pede o
 * login de novo. O client id e publico (vai no bundle), o token nao.
 *
 * O cofre e a propria pasta `Dyarium/` na raiz do Drive: o layout do
 * `vaultLayout` ja separa tudo por subpasta, entao nao existe uma pasta por
 * cofre aqui.
 */

import { DriveClient } from "./drive";
import { DriveFolder } from "./driveFolder";
import {
  googleClientId,
  requestDriveToken,
  tokenIsFresh,
  type DriveToken,
} from "./google";

export type DriveSessionState = "off" | "connected" | "expired";

let token: DriveToken | null = null;
let client: DriveClient | null = null;

const ouvintes = new Set<() => void>();
/** Evita avisar duas vezes pela mesma expiracao (estado e cliente consultados juntos). */
let expiracaoAvisada = false;

function notificar(): void {
  for (const ouvinte of [...ouvintes]) {
    try {
      ouvinte();
    } catch {
      // Um ouvinte com defeito nao pode impedir os outros de saber da mudanca.
    }
  }
}

/** O aviso sai no fim do turno: quem chamou pode estar no meio do render. */
function agendarAvisoDeExpiracao(): void {
  if (expiracaoAvisada) return;
  expiracaoAvisada = true;
  queueMicrotask(notificar);
}

/** Ha client id configurado? Sem ele a tela nem oferece o botao. */
export function driveConfigured(): boolean {
  return googleClientId().length > 0;
}

/**
 * Pede o token ao Google e guarda a sessao em memoria. Precisa de gesto do
 * usuario: a janela do GIS nao abre por script.
 */
export async function connectDrive(): Promise<DriveClient> {
  const novo = await requestDriveToken();
  token = novo;
  client = new DriveClient(novo.accessToken);
  expiracaoAvisada = false;
  notificar();
  return client;
}

/** Cliente usavel agora, ou null sem token/token vencido. */
export function driveClient(): DriveClient | null {
  if (!token) return null;
  if (!tokenIsFresh(token)) {
    agendarAvisoDeExpiracao();
    return null;
  }
  return client;
}

export function disconnectDrive(): void {
  const tinhaSessao = token !== null;
  token = null;
  client = null;
  expiracaoAvisada = false;
  if (tinhaSessao) notificar();
}

export function driveSessionState(): DriveSessionState {
  if (!token) return "off";
  if (tokenIsFresh(token)) return "connected";
  agendarAvisoDeExpiracao();
  return "expired";
}

export function onDriveSessionChange(cb: () => void): () => void {
  ouvintes.add(cb);
  return () => {
    ouvintes.delete(cb);
  };
}

/** Pasta `Dyarium` na raiz do Drive, pronta para o layout do cofre. */
export async function driveVaultRoot(): Promise<DriveFolder> {
  const atual = driveClient();
  if (!atual) throw new Error("Drive nao conectado");
  const id = await atual.ensureFolder("Dyarium");
  return new DriveFolder(atual, id, "Dyarium");
}
