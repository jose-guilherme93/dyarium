/**
 * Descoberta automatica do servidor dyarium.
 *
 * No desenvolvimento, o Metro roda na mesma maquina que a API (caso comum: o
 * app conecta via tailnet no host de dev). Entao derivamos o host a partir do
 * dev server e procuramos a API ali, na porta padrao 8080.
 */

import Constants from 'expo-constants';

const PORTS = [8080, 18080, 8000];

/** Host do dev server (ex.: "100.115.101.127:8081" -> "100.115.101.127"). */
function devHost(): string | null {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost;
  if (!hostUri) return null;
  const host = hostUri.split('/')[0].split(':')[0];
  return host || null;
}

async function probe(baseUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const response = await fetch(`${baseUrl}/healthz`, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return false;
    const body = (await response.json()) as { status?: string };
    return body?.status === 'ok';
  } catch {
    return false;
  }
}

/** Retorna a primeira baseUrl que responde a /healthz, ou null. */
export async function discoverServer(): Promise<string | null> {
  const host = devHost();
  const candidates: string[] = [];
  if (host) {
    for (const port of PORTS) candidates.push(`http://${host}:${port}`);
  }
  for (const port of PORTS) candidates.push(`http://localhost:${port}`);
  for (const candidate of candidates) {
    if (await probe(candidate)) return candidate;
  }
  return null;
}
