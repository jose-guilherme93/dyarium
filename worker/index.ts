/**
 * Worker do site hospedado: o pulso anonimo de uso e a API do painel /admin.
 *
 * O site e estatico (`web/dist`); este Worker intercepta tres caminhos e
 * devolve o resto para os assets, com o fallback de SPA do wrangler.jsonc.
 *
 * Privacidade: o pulso leva um id aleatorio de instalacao, evento, versao,
 * navegador e, SO no login com Google, o e-mail da conta. Nunca leva nota,
 * audio, token, IP (nao lemos `CF-Connecting-IP`) nem header. O corpo nao e
 * logado em lugar nenhum e a resposta do painel e `no-store`.
 */

interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  success?: boolean;
}

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<D1Result>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

interface D1Database {
  prepare(sql: string): D1Statement;
  batch(stmts: D1Statement[]): Promise<D1Result[]>;
}

interface Env {
  ASSETS?: { fetch(request: Request): Promise<Response> };
  DB: D1Database;
  ADMIN_TOKEN: string;
}

const FUSO = "America/Sao_Paulo";
const LIMITE_CORPO = 4096;
const RETENCAO_DIAS = 180;
const MAX_DIAS = 90;
const MAX_CONTAS = 200;
const INSTALL_RE = /^[0-9a-f-]{16,64}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Data de hoje (AAAA-MM-DD) no fuso do dono; o cliente nunca manda o dia. */
function diaLocal(quando: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(quando);
}

function json(dados: unknown, status = 200): Response {
  return new Response(JSON.stringify(dados), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...CORS,
    },
  });
}

function semCorpo(status = 204): Response {
  return new Response(null, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...CORS,
    },
  });
}

/**
 * O site e o painel vivem no dominio principal; a API pode viver num Worker
 * separado (workers.dev). O pulso e publico e o painel exige Bearer, entao
 * liberar a origem nao expoe dado: nao existe cookie nem credencial automatica.
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

/** Compara em tempo constante: o tamanho vaza, o conteudo nao. */
function iguais(a: string, b: string): boolean {
  const esquerda = new TextEncoder().encode(a);
  const direita = new TextEncoder().encode(b);
  if (esquerda.length !== direita.length) return false;
  let diferenca = 0;
  for (let i = 0; i < esquerda.length; i += 1) {
    diferenca |= esquerda[i] ^ direita[i];
  }
  return diferenca === 0;
}

function autorizado(request: Request, env: Env): boolean {
  const cabecalho = request.headers.get("Authorization") ?? "";
  if (!cabecalho.startsWith("Bearer ")) return false;
  const token = cabecalho.slice("Bearer ".length).trim();
  if (!token || !env.ADMIN_TOKEN) return false;
  return iguais(token, env.ADMIN_TOKEN);
}

function inteiro(valor: unknown, maximo: number): number | null {
  if (typeof valor !== "number" || !Number.isFinite(valor)) return null;
  const n = Math.trunc(valor);
  if (n < 0 || n > maximo) return null;
  return n;
}

function texto(valor: unknown, maximo: number): string {
  if (typeof valor !== "string") return "";
  return valor.trim().slice(0, maximo);
}

interface Pulso {
  install: string;
  event: "boot" | "connect";
  version: string;
  platform: string;
  email: string | null;
  notes: number | null;
  bytes: number | null;
  hasDrive: number | null;
}

function lerPulso(dados: unknown): Pulso | string {
  if (!dados || typeof dados !== "object") return "corpo invalido";
  const corpo = dados as Record<string, unknown>;
  const install = texto(corpo.install, 64);
  if (!INSTALL_RE.test(install)) return "install invalido";
  const event = corpo.event;
  if (event !== "boot" && event !== "connect") return "evento invalido";
  const version = texto(corpo.version, 32);
  const platform = texto(corpo.platform, 16) || "web";
  if (!["web", "android", "ios"].includes(platform)) return "plataforma invalida";

  let email: string | null = null;
  if (corpo.email !== undefined) {
    // E-mail so acompanha o login; um boot com e-mail e recusado em vez de
    // descartado em silencio (sintoma de cliente errado).
    if (event !== "connect") return "email fora do login";
    const bruto = texto(corpo.email, 254).toLowerCase();
    if (!EMAIL_RE.test(bruto)) return "email invalido";
    email = bruto;
  }

  const notes = corpo.notes === undefined ? null : inteiro(corpo.notes, 100_000_000);
  const bytes = corpo.bytes === undefined ? null : inteiro(corpo.bytes, 100_000_000_000_000);
  if (corpo.notes !== undefined && notes === null) return "notes invalido";
  if (corpo.bytes !== undefined && bytes === null) return "bytes invalido";
  // `null` = o cliente nao informou agora; nao apaga o que ja sabiamos.
  const hasDrive =
    corpo.has_drive === undefined ? null : corpo.has_drive === true ? 1 : 0;

  return { install, event, version, platform, email, notes, bytes, hasDrive };
}

async function pulso(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "POST") return json({ error: "metodo invalido" }, 405);
  const comprimento = Number(request.headers.get("Content-Length") ?? "0");
  if (comprimento > LIMITE_CORPO) return json({ error: "corpo grande" }, 413);

  const bruto = await request.text();
  if (bruto.length > LIMITE_CORPO) return json({ error: "corpo grande" }, 413);
  let dados: unknown;
  try {
    dados = JSON.parse(bruto);
  } catch {
    return json({ error: "json invalido" }, 400);
  }
  const pulsoLido = lerPulso(dados);
  if (typeof pulsoLido === "string") return json({ error: pulsoLido }, 400);

  const dia = diaLocal();
  const { install, event, version, platform, email, notes, bytes, hasDrive } = pulsoLido;

  const comandos = [
    env.DB.prepare(
      `INSERT INTO install (id, first_day, last_day, version, platform, notes, bytes, has_drive)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         last_day = excluded.last_day,
         version = CASE WHEN excluded.version <> '' THEN excluded.version ELSE install.version END,
         platform = CASE WHEN excluded.platform <> '' THEN excluded.platform ELSE install.platform END,
         notes = COALESCE(excluded.notes, install.notes),
         bytes = COALESCE(excluded.bytes, install.bytes),
         has_drive = COALESCE(excluded.has_drive, install.has_drive)`,
    ).bind(install, dia, dia, version, platform, notes, bytes, hasDrive),
    env.DB.prepare("INSERT OR IGNORE INTO event (day, kind, install) VALUES (?, ?, ?)").bind(
      dia,
      event,
      install,
    ),
  ];

  if (email) {
    comandos.push(
      env.DB.prepare(
        `INSERT INTO account (email, first_day, last_day) VALUES (?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET last_day = excluded.last_day`,
      ).bind(email, dia, dia),
      env.DB.prepare("UPDATE install SET email = ? WHERE id = ?").bind(email, install),
    );
  }

  await env.DB.batch(comandos);
  return semCorpo();
}

function numero(valor: unknown): number {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : 0;
}

async function estatisticas(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET") return json({ error: "metodo invalido" }, 405);
  if (!autorizado(request, env)) return json({ error: "unauthorized" }, 401);

  const pedido = Number(url.searchParams.get("days") ?? "30");
  const janela = Number.isFinite(pedido)
    ? Math.min(MAX_DIAS, Math.max(7, Math.trunc(pedido)))
    : 30;

  const dias: string[] = [];
  const agora = Date.now();
  for (let i = janela - 1; i >= 0; i -= 1) {
    dias.push(diaLocal(new Date(agora - i * 86_400_000)));
  }
  const desde = dias[0];

  const [ativos, logins, novas, totais, contas, versoes] = await env.DB.batch([
    env.DB.prepare(
      "SELECT day, COUNT(*) AS n FROM event WHERE kind = 'boot' AND day >= ? GROUP BY day",
    ).bind(desde),
    env.DB.prepare(
      `SELECT e.day AS day, COUNT(DISTINCT i.email) AS n
       FROM event e JOIN install i ON i.id = e.install
       WHERE e.kind = 'connect' AND e.day >= ? AND i.email IS NOT NULL
       GROUP BY e.day`,
    ).bind(desde),
    env.DB.prepare(
      "SELECT first_day AS day, COUNT(*) AS n FROM account WHERE first_day >= ? GROUP BY first_day",
    ).bind(desde),
    env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM account) AS accounts,
         (SELECT COUNT(*) FROM install) AS installs,
         (SELECT COUNT(*) FROM install WHERE has_drive = 1) AS vaults,
         (SELECT COALESCE(SUM(notes), 0) FROM (
            SELECT email, MAX(notes) AS notes FROM install WHERE email IS NOT NULL GROUP BY email
            UNION ALL
            SELECT id AS email, notes FROM install WHERE email IS NULL
         )) AS notes,
         (SELECT COALESCE(SUM(bytes), 0) FROM (
            SELECT email, MAX(bytes) AS bytes FROM install WHERE email IS NOT NULL GROUP BY email
            UNION ALL
            SELECT id AS email, bytes FROM install WHERE email IS NULL
         )) AS bytes`,
    ),
    env.DB.prepare(
      `SELECT a.email, a.first_day, a.last_day,
         (SELECT COUNT(*) FROM install i WHERE i.email = a.email) AS installs,
         (SELECT COALESCE(MAX(i.notes), 0) FROM install i WHERE i.email = a.email) AS notes,
         (SELECT COALESCE(MAX(i.bytes), 0) FROM install i WHERE i.email = a.email) AS bytes,
         (SELECT i.version FROM install i WHERE i.email = a.email ORDER BY i.last_day DESC LIMIT 1) AS version,
         (SELECT i.platform FROM install i WHERE i.email = a.email ORDER BY i.last_day DESC LIMIT 1) AS platform
       FROM account a
       ORDER BY a.last_day DESC, a.email ASC
       LIMIT ${MAX_CONTAS}`,
    ),
    env.DB.prepare(
      `SELECT version, COUNT(*) AS installs FROM install
       WHERE last_day >= ? AND version <> ''
       GROUP BY version ORDER BY installs DESC LIMIT 20`,
    ).bind(desde),
  ]);

  const porDia = new Map<string, { day: string; active: number; logins: number; new_accounts: number }>(
    dias.map((dia) => [dia, { day: dia, active: 0, logins: 0, new_accounts: 0 }]),
  );
  for (const linha of ativos.results ?? []) {
    const alvo = porDia.get(String(linha.day));
    if (alvo) alvo.active = numero(linha.n);
  }
  for (const linha of logins.results ?? []) {
    const alvo = porDia.get(String(linha.day));
    if (alvo) alvo.logins = numero(linha.n);
  }
  for (const linha of novas.results ?? []) {
    const alvo = porDia.get(String(linha.day));
    if (alvo) alvo.new_accounts = numero(linha.n);
  }

  const serie = dias.map((dia) => porDia.get(dia)!);
  const hoje = serie[serie.length - 1] ?? {
    day: diaLocal(),
    active: 0,
    logins: 0,
    new_accounts: 0,
  };
  const total = totais.results?.[0] ?? {};

  return json({
    generated_at: new Date().toISOString(),
    days: serie,
    today: {
      active: hoje.active,
      logins: hoje.logins,
      new_accounts: hoje.new_accounts,
    },
    totals: {
      accounts: numero(total.accounts),
      installs: numero(total.installs),
      vaults: numero(total.vaults),
      notes: numero(total.notes),
      bytes: numero(total.bytes),
    },
    accounts: (contas.results ?? []).map((linha) => ({
      email: String(linha.email),
      first_day: String(linha.first_day),
      last_day: String(linha.last_day),
      installs: numero(linha.installs),
      notes: numero(linha.notes),
      bytes: numero(linha.bytes),
      version: String(linha.version ?? ""),
      platform: String(linha.platform ?? ""),
    })),
    versions: (versoes.results ?? []).map((linha) => ({
      version: String(linha.version),
      installs: numero(linha.installs),
    })),
  });
}

async function removerConta(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "DELETE") return json({ error: "metodo invalido" }, 405);
  if (!autorizado(request, env)) return json({ error: "unauthorized" }, 401);
  const email = (url.searchParams.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: "email invalido" }, 400);

  const existia = await env.DB.prepare("SELECT 1 AS n FROM account WHERE email = ?")
    .bind(email)
    .first<{ n: number }>();
  await env.DB.batch([
    // O historico de uso continua anonimo: o install deixa de apontar para a conta.
    env.DB.prepare("UPDATE install SET email = NULL WHERE email = ?").bind(email),
    env.DB.prepare("DELETE FROM account WHERE email = ?").bind(email),
  ]);
  return json({ removed: Boolean(existia) });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const api =
      url.pathname === "/pulse" ||
      url.pathname === "/admin-api/stats" ||
      url.pathname === "/admin-api/account";
    if (api && request.method === "OPTIONS") return semCorpo();
    if (url.pathname === "/pulse") return pulso(request, env, url);
    if (url.pathname === "/admin-api/stats") return estatisticas(request, env, url);
    if (url.pathname === "/admin-api/account") return removerConta(request, env, url);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("nao encontrado", { status: 404 });
  },

  async scheduled(_event: unknown, env: Env): Promise<void> {
    const limite = diaLocal(new Date(Date.now() - RETENCAO_DIAS * 86_400_000));
    await env.DB.prepare("DELETE FROM event WHERE day < ?").bind(limite).run();
  },
};
