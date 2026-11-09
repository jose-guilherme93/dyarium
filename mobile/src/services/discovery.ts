/**
 * Descoberta automatica do servidor dyarium.
 *
 * No desenvolvimento, o Metro roda na mesma maquina que a API (caso comum: o
 * app conecta via tailnet no host de dev). Entao derivamos o host a partir do
 * dev server e procuramos a API ali, na porta padrao 8080.
 *
 * O probe so prova que o servico PARECE um dyarium: /healthz responde
 * `{"status":"ok","version":"..."}`. Sem token nao da para conferir o contrato
 * de sincronizacao (as rotas de /api/v1 exigem Bearer), entao quem confirma a
 * identidade do ambiente e o teste em `SettingsContext.save()`. Um host pode
 * rodar mais de um dyarium; nesse caso a descoberta aponta o primeiro que
 * responde e o usuario confirma na tela do servidor.
 */

import Constants from 'expo-constants';

const PORTS = [8080, 18080, 8000];

/** Host do dev server (ex.: "192.0.2.10:8081" -> "192.0.2.10"). */
function devHost(): string | null {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost;
  if (!hostUri) return null;
  const host = hostUri.split('/')[0].split(':')[0];
  return host || null;
}

async function probe(baseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${baseUrl}/healthz`, { signal: controller.signal });
    if (!response.ok) return false;
    // O /healthz do dyarium sempre traz a versao. Servico que responde so
    // `{"status":"ok"}` (health check generico) nao passa: era assim que a
    // descoberta preenchia a URL de outro servico na mesma maquina.
    const body = (await response.json()) as { status?: string; version?: string };
    return body?.status === 'ok' && typeof body.version === 'string' && body.version.length > 0;
  } catch {
    return false;
  } finally {
    // Tambem no caminho de erro: sem isto o timer de abort ficava pendente
    // depois de uma falha de rede.
    clearTimeout(timer);
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
