/**
 * Identidade do Google no navegador (nome, e-mail, foto).
 *
 * E so exibicao: nunca autorizacao. O access token continua vivendo so na
 * memoria do `driveSession`; aqui guardamos apenas o perfil (nao secreto) para
 * a foto pintar no recarregamento antes de qualquer rede.
 */

export interface GoogleProfile {
  name: string;
  email: string;
  picture: string;
}

const ACCOUNT_KEY = "dyarium.account";

const ouvintes = new Set<(profile: GoogleProfile | null) => void>();

function notificar(profile: GoogleProfile | null): void {
  for (const ouvinte of [...ouvintes]) {
    try {
      ouvinte(profile);
    } catch {
      // Um ouvinte com defeito nao pode impedir os outros.
    }
  }
}

export function cachedProfile(): GoogleProfile | null {
  try {
    const bruto = localStorage.getItem(ACCOUNT_KEY);
    if (!bruto) return null;
    const guardado = JSON.parse(bruto) as unknown;
    if (!guardado || typeof guardado !== "object") return null;
    const p = guardado as Record<string, unknown>;
    if (
      typeof p.name !== "string" ||
      typeof p.email !== "string" ||
      typeof p.picture !== "string"
    ) {
      return null;
    }
    return { name: p.name, email: p.email, picture: p.picture };
  } catch {
    return null;
  }
}

export function cacheProfile(profile: GoogleProfile): void {
  try {
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(profile));
  } catch {
    // Sem localStorage a foto nao persiste; a sessao viva nao depende disto.
  }
  notificar(profile);
}

/** Alias para quem prefere o nome "set". */
export const setCachedProfile = cacheProfile;

export function clearAccountCache(): void {
  try {
    localStorage.removeItem(ACCOUNT_KEY);
  } catch {
    // Sem localStorage nada a limpar.
  }
  notificar(null);
}

export function onAccountChange(
  listener: (profile: GoogleProfile | null) => void,
): () => void {
  ouvintes.add(listener);
  return () => {
    ouvintes.delete(listener);
  };
}

export async function fetchProfile(
  accessToken: string,
  fetchImpl?: typeof fetch,
): Promise<GoogleProfile | null> {
  const fetcher = fetchImpl ?? globalThis.fetch;
  // A identidade e enfeite: nao pode segurar a tela se a rede travar.
  const sinal =
    typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(5000)
      : undefined;
  try {
    const res = await fetcher("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: sinal,
    });
    if (!res || !res.ok) return null;
    const data = (await res.json()) as unknown;
    if (!data || typeof data !== "object") return null;
    const d = data as Record<string, unknown>;
    const profile: GoogleProfile = {
      name: typeof d.name === "string" ? d.name : "",
      email: typeof d.email === "string" ? d.email : "",
      picture: typeof d.picture === "string" ? d.picture : "",
    };
    // Consentimento granular pode liberar o Drive sem liberar perfil: nesse
    // caso nao ha identidade a mostrar e o cache bom nao pode ser apagado.
    if (!profile.name && !profile.email && !profile.picture) return null;
    cacheProfile(profile);
    return profile;
  } catch {
    return null;
  }
}