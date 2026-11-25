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
import type { GoogleProfile } from "./account";
import {
  cachedProfile as accountCachedProfile,
  clearAccountCache,
  fetchProfile,
} from "./account";

export type DriveSessionState = "off" | "connected" | "expired";

let token: DriveToken | null = null;
let client: DriveClient | null = null;
let profile: GoogleProfile | null = null;

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

function aplicarToken(novo: DriveToken): void {
  token = novo;
  client = new DriveClient(novo.accessToken);
  expiracaoAvisada = false;
}

/**
 * O token veio com os escopos de identidade? O Google pode liberar o Drive com
 * consentimento granular sem email/profile; nesse caso a foto nao vem pelo
 * userinfo e o avatar fica nas iniciais ate um consentimento explicito.
 */
export function tokenTemIdentidade(scope: string | undefined): boolean {
  if (!scope) return false;
  const concedidos = new Set(scope.split(/[\s,]+/).filter(Boolean));
  // O Google devolve `email`/`profile` como URLs de userinfo na resposta real;
  // os nomes curtos continuam aceitos para o token que os trouxer assim.
  const tem = (nome: "email" | "profile"): boolean =>
    concedidos.has(nome) ||
    concedidos.has(`https://www.googleapis.com/auth/userinfo.${nome}`);
  return tem("email") && tem("profile");
}

/** Busca a identidade sem segurar o Drive; so aplica se a sessao ainda for a mesma. */
async function buscarPerfil(novo: DriveToken): Promise<void> {
  const obtido = await fetchProfile(novo.accessToken).catch(() => null);
  if (!obtido || token?.accessToken !== novo.accessToken) return;
  profile = obtido;
  notificar();
}

/**
 * Pede o token ao Google e guarda a sessao em memoria. Precisa de gesto do
 * usuario: a janela do GIS nao abre por script.
 *
 * O pedido de consentimento de identidade so acontece no login interativo. No
 * silencioso e no carregamento automatico, nada de tela do Google: sem
 * email/profile o avatar continua com o que estiver no cache.
 */
export async function connectDrive(options?: { silent?: boolean }): Promise<DriveClient> {
  let atual = await requestDriveToken(options);
  aplicarToken(atual);
  profile = accountCachedProfile();
  notificar();

  if (tokenTemIdentidade(atual.scope)) {
    // A foto entra quando o userinfo responde: o login nao espera a rede de
    // identidade para liberar o Drive.
    void buscarPerfil(atual);
  } else if (!options?.silent) {
    try {
      const consentido = await requestDriveToken({ prompt: "consent" });
      if (token?.accessToken === atual.accessToken) {
        aplicarToken(consentido);
        notificar();
      }
      atual = consentido;
      await buscarPerfil(consentido);
    } catch {
      // O cofre segue com o token do Drive; a foto fica nas iniciais.
    }
  } else {
    // Mesmo sem escopo de identidade, o userinfo pode ter o que ja foi
    // consentido antes; e so rede, nunca tela.
    void buscarPerfil(atual);
  }
  return client ?? new DriveClient(atual.accessToken);
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
  const tinhaSessao = token !== null || profile !== null;
  token = null;
  client = null;
  profile = null;
  expiracaoAvisada = false;
  clearAccountCache();
  if (tinhaSessao) notificar();
}

/** Revoga o token vivo, best effort: ele ja sai da memoria de qualquer forma. */
export function revokeDriveToken(): void {
  const atual = token;
  if (!atual) return;
  try {
    void fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: atual.accessToken }).toString(),
    }).catch(() => undefined);
  } catch {
    // Sem rede, nada a revogar agora.
  }
}

export interface SignOutOptions {
  /** Sair sem tentar gravar o pendente (acao destrutiva e explicita). */
  discard?: boolean;
  /** Grava o cofre e devolve se o snapshot foi confirmado. */
  save?: () => Promise<boolean>;
  /** Ha alteracao local que ainda nao subiu. */
  hasPending?: () => boolean | Promise<boolean>;
  /** Apaga o cache local; injetavel para o teste nao tocar em OPFS/IndexedDB. */
  wipe?: () => Promise<void>;
}

export interface SignOutFailure {
  ok: false;
  reason: "save-failed" | "pending" | "wipe-failed";
  message: string;
}

export type SignOutResult = { ok: true } | SignOutFailure;

/**
 * Sai da conta Google neste navegador.
 *
 * Com sessao, grava o pendente e confirma o retrato antes de apagar. Sem
 * sessao e com pendencia, nao apaga: o cache e o unico lugar das mudancas.
 * So o `discard` explicito passa por cima. A limpeza real (banco, OPFS e
 * stores de anexos/capas) fica em `signOut` para nao criar ciclo de imports.
 */
export async function signOutAccount(options?: SignOutOptions): Promise<SignOutResult> {
  const { leaveAccount } = await import("./signOut");
  return leaveAccount(options);
}

export function driveProfile(): GoogleProfile | null {
  return profile ?? accountCachedProfile();
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
