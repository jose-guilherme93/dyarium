/**
 * Sessao do Google Drive no navegador.
 *
 * O access token vive na memoria deste modulo e na sessao desta aba
 * (`sessionStorage`), nunca em localStorage, IndexedDB ou cookie: o F5 nao
 * pede login de novo e a credencial some quando a aba fecha. Sem refresh token
 * guardado, nao ha credencial de longa duracao para vazar; quando o token vence,
 * o estado vira "expired" e um pedido silencioso ao Google tenta renovar antes
 * de qualquer tela. O client id e publico (vai no bundle), o token nao.
 *
 * O cofre e a propria pasta `Dyarium/` na raiz do Drive: o layout do
 * `vaultLayout` ja separa tudo por subpasta, entao nao existe uma pasta por
 * cofre aqui.
 */

import { DriveClient } from "./drive";
import { pulseConnect } from "../lib/pulse";
import { DriveFolder } from "./driveFolder";
import {
  consumeDriveRedirect,
  googleClientId,
  requestDriveToken,
  startDriveLogin,
  tokenIsFresh,
  type DriveToken,
  type DriveTokenOptions,
} from "./google";
import type { GoogleProfile } from "./account";
import {
  cachedProfile as accountCachedProfile,
  clearAccountCache,
  fetchProfile,
} from "./account";

export type DriveSessionState = "off" | "connected" | "expired";

/** Chave da sessao desta aba; o valor tem token e validade, nunca em claro em log. */
export const DRIVE_SESSION_KEY = "dyarium.drive.session";

let token: DriveToken | null = null;
let client: DriveClient | null = null;
let profile: GoogleProfile | null = null;

/** Retorno do redirect do Google, lido uma vez no carregamento da pagina. */
let retornoDoLogin: { erro: string } | { ok: true } | null = null;

const ouvintes = new Set<() => void>();
/** Evita avisar duas vezes pela mesma expiracao (estado e cliente consultados juntos). */
let expiracaoAvisada = false;

/** Guarda a sessao na aba; sem storage, a sessao segue so na memoria. */
function gravarSessao(atual: DriveToken | null): void {
  try {
    if (!atual) {
      sessionStorage.removeItem(DRIVE_SESSION_KEY);
      return;
    }
    sessionStorage.setItem(
      DRIVE_SESSION_KEY,
      JSON.stringify({
        accessToken: atual.accessToken,
        expiresAt: atual.expiresAt,
        scope: atual.scope,
      }),
    );
  } catch {
    // Sem sessionStorage (modo privado antigo, cota): a aba continua logada
    // ate o F5, como antes.
  }
}

/** Le a sessao guardada nesta aba; vencida ou ilegivel sai do armazenamento. */
function lerSessaoGuardada(): DriveToken | null {
  let bruto: string | null;
  try {
    bruto = sessionStorage.getItem(DRIVE_SESSION_KEY);
  } catch {
    return null;
  }
  if (!bruto) return null;
  try {
    const dado = JSON.parse(bruto) as {
      accessToken?: unknown;
      expiresAt?: unknown;
      scope?: unknown;
    };
    if (
      typeof dado?.accessToken !== "string" ||
      dado.accessToken.length === 0 ||
      typeof dado.expiresAt !== "number" ||
      !Number.isFinite(dado.expiresAt)
    ) {
      gravarSessao(null);
      return null;
    }
    const sessao: DriveToken = {
      accessToken: dado.accessToken,
      expiresAt: dado.expiresAt,
      scope: typeof dado.scope === "string" ? dado.scope : undefined,
    };
    if (!tokenIsFresh(sessao)) {
      gravarSessao(null);
      return null;
    }
    return sessao;
  } catch {
    gravarSessao(null);
    return null;
  }
}

/**
 * Retoma a sessao que a aba ja tinha. Idempotente: com token vivo, nada muda.
 * Roda no carregamento do modulo e pode ser chamada de novo sem efeito.
 */
export function restoreDriveSession(): void {
  if (token) return;
  const guardado = lerSessaoGuardada();
  if (!guardado) return;
  token = guardado;
  client = new DriveClient(guardado.accessToken);
  profile = accountCachedProfile();
}

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
  gravarSessao(novo);
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
  if (obtido.email.trim()) {
    pulseConnect(obtido.email);
  }
}

/**
 * Pede o token ao Google e guarda a sessao em memoria. Precisa de gesto do
 * usuario: a janela do GIS nao abre por script.
 *
 * O pedido de consentimento de identidade so acontece no login interativo. No
 * silencioso e no carregamento automatico, nada de tela do Google: sem
 * email/profile o avatar continua com o que estiver no cache.
 */
export async function connectDrive(options?: DriveTokenOptions): Promise<DriveClient> {
  let atual: DriveToken;
  if (options?.redirect) {
    if (token && tokenIsFresh(token)) {
      // Voltamos do redirect: o token ja esta na memoria, so falta abrir.
      atual = token;
    } else {
      // Login interativo: a aba vai para o Google e volta com o token. Este
      // await nao resolve — a pagina e descarregada aqui.
      startDriveLogin();
      atual = await new Promise<DriveToken>(() => undefined);
    }
  } else {
    atual = await requestDriveToken(options);
  }
  aplicarToken(atual);
  profile = accountCachedProfile();
  notificar();

  // A identidade (nome, email, foto) e opcional e vem do userinfo com o mesmo
  // token. Um segundo pedido de consentimento abriria outra janela depois do
  // gesto do usuario: o Chrome bloqueia e o login fica preso em "entrando com
  // o Google". Sem identidade, o avatar fica nas iniciais.
  void buscarPerfil(atual);

  return client ?? new DriveClient(atual.accessToken);
}

/** Cliente usavel agora, ou null sem token/token vencido. */
export function driveClient(): DriveClient | null {
  if (!token) return null;
  if (!tokenIsFresh(token)) {
    gravarSessao(null);
    agendarAvisoDeExpiracao();
    return null;
  }
  return client;
}

/** Quando a sessao desta aba vence; null sem sessao viva. */
export function driveSessionExpiresAt(): number | null {
  return token?.expiresAt ?? null;
}

export function disconnectDrive(): void {
  const tinhaSessao = token !== null || profile !== null;
  token = null;
  client = null;
  profile = null;
  expiracaoAvisada = false;
  gravarSessao(null);
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
  gravarSessao(null);
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

// F5 nesta aba: o sessionStorage ja tem a sessao, entao o app abre conectado
// sem falar com o Google. Sem sessao guardada, o estado fica "off".
restoreDriveSession();

/**
 * Le o retorno do redirect do Google uma unica vez, no carregamento da pagina.
 * O token entra na sessao; a UI so precisa saber que houve login para retomar
 * a abertura do cofre.
 */
function lerRetornoDoLogin(): void {
  try {
    const retorno = consumeDriveRedirect();
    if (!retorno) return;
    aplicarToken(retorno.token);
    profile = accountCachedProfile();
    notificar();
    void buscarPerfil(retorno.token);
    retornoDoLogin = { ok: true };
  } catch (erro) {
    retornoDoLogin = { erro: erro instanceof Error ? erro.message : String(erro) };
  }
}
lerRetornoDoLogin();

/** Uma vez: o retorno do redirect, ou null quando a carga foi normal. */
export function takeDriveLoginReturn(): { erro: string } | { ok: true } | null {
  const atual = retornoDoLogin;
  retornoDoLogin = null;
  return atual;
}
