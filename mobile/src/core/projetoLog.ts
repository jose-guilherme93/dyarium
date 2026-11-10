// Leitura pura do log de projetos do caderno MCP (docs/projetos.md).
// Markdown entra, indice tipado sai. Sem React, sem fetch, sem DOM: o mesmo
// modulo atende o dashboard (web/) e o app (mobile/).

export type LogItemKind = "feat" | "fix" | "perf" | "test" | "docs" | "chore";

export type LogItem = {
  kind: string;
  title: string;
  detail?: string;
  commit?: string;
  url?: string;
  project: string;
  date: string;
  time: string;
  sessionId: string;
};

export type LogCommit = {
  hash: string;
  message?: string;
  url?: string;
};

export type LogLink = {
  label?: string;
  url: string;
};

export type LogSession = {
  project: string;
  date: string;
  time: string;
  host: string;
  detail: "concise" | "full";
  summary?: string;
  items: LogItem[];
  commits: LogCommit[];
  links: LogLink[];
  marker?: string;
  legacy: boolean;
  sessionId: string;
};

// Formato escrito por internal/mcpserver/render.go: um bloco por sessao com
// cabecalho "## YYYY-MM-DD HH:MM · host", itens "- **kind** titulo · commit",
// o recolhivel ":::details" e, no moderno, o fence dyarium-json + marcador.
const headerPattern = /^##\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)\s+·\s+(.*)$/;
const markerPattern = /<!--\s*mcp:([0-9a-f]+)\s*-->/;
const itemLinePattern = /^- \*\*(.+?)\*\*\s+(.*)$/;
const listLinePattern = /^-\s+(.*)$/;
const boldPattern = /^\*\*([^*]+)\*\*\s+(.*)$/;
const detailsClosePattern = /^:::\s*$/;
const detailsOpenStatePattern = /(^|\s)open(\s|$)/;
const fenceOpenPattern = /^```dyarium-json\s*$/;
const fenceClosePattern = /^```\s*$/;
const hashPattern = /^[0-9a-f]{7,40}$/;
const urlPattern = /^https?:\/\/\S+$/;
const markdownLinkPattern = /^\[([^\]]*)\]\((\S+)\)$/;
const itemTailPattern = /(?:^|\s)·\s+(.+)$/;
const dashSeparator = " — ";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

// Identidade de sessao sem marcador: hash deterministico curto (FNV-1a 32
// bits) do conteudo do fence, so para desempate de duplicatas.
function stableHash(text: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(16).padStart(8, "0");
}

function splitLines(markdown: string): string[] {
  return markdown.split("\n").map((line) => line.replace(/\r$/, ""));
}

// Corta um url http(s) solto no fim da linha: render.go escreve o destino
// depois da mensagem em commits e links do bloco tecnico.
function splitTrailingUrl(text: string): { url: string; rest: string } | null {
  const at = text.lastIndexOf("http");
  if (at < 0) return null;
  const tail = text.slice(at);
  if (!urlPattern.test(tail)) return null;
  return { url: tail, rest: text.slice(0, at).trim() };
}

type BareRead =
  | { type: "commit"; hash: string; message?: string; url?: string }
  | { type: "link"; label?: string; url: string };

// Uma linha simples de lista, fora de item: "[label](url)", "label: url",
// url pura, "hash mensagem url" ou "hash — mensagem".
function readCommitOrLink(text: string): BareRead | null {
  const markdownLink = markdownLinkPattern.exec(text);
  if (markdownLink) {
    return { type: "link", label: markdownLink[1] || undefined, url: markdownLink[2] };
  }
  const fromUrl = splitTrailingUrl(text);
  if (!fromUrl && urlPattern.test(text)) {
    return { type: "link", url: text };
  }
  const labeled = /^(.+?):\s+(\S+)$/.exec(fromUrl ? "" : text);
  if (labeled && urlPattern.test(labeled[2])) {
    return { type: "link", label: labeled[1].trim() || undefined, url: labeled[2] };
  }
  const source = fromUrl ? fromUrl.rest : text;
  if (!source) {
    return fromUrl ? { type: "link", url: fromUrl.url } : null;
  }
  // Rotulo curto em linha de link: "label:" logo antes do url.
  if (fromUrl) {
    const labelLike = /^(.+?):\s*$/.exec(fromUrl.rest);
    if (labelLike) {
      return { type: "link", label: labelLike[1].trim() || undefined, url: fromUrl.url };
    }
  }
  const head = firstToken(source);
  const message = source.slice(head.length).trim().replace(/^—\s*/, "").trim();
  if (hashPattern.test(head)) {
    return {
      type: "commit",
      hash: head,
      message: message || undefined,
      url: fromUrl?.url,
    };
  }
  const messageOnly: BareRead = fromUrl
    ? { type: "commit", hash: "", message: source || undefined, url: fromUrl.url }
    : { type: "commit", hash: "", message: source || undefined };
  if (!messageOnly.message && !messageOnly.url) return null;
  return messageOnly;
}

function firstToken(text: string): string {
  const at = text.indexOf(" ");
  return at < 0 ? text : text.slice(0, at);
}

// Le um item "- **kind** title · [hash](url)" (ou " · hash" sem link).
function readItemLine(text: string): DraftItem | null {
  const bold = itemLinePattern.exec(text);
  if (!bold) return null;
  const kind = bold[1].trim();
  const rest = bold[2].trim();
  const tail = itemTailPattern.exec(rest);
  if (!tail) {
    return { kind, title: rest };
  }
  const title = rest.slice(0, tail.index).trim();
  const tailValue = tail[1];
  const link = markdownLinkPattern.exec(tailValue);
  if (link) {
    return { kind, title, commit: link[1] || undefined, url: link[2] };
  }
  return { kind, title, commit: tailValue.trim() || undefined };
}

// Detalhe de item, nos dois formatos aceitos: "**kind** titulo — detalhe" e
// "titulo: detalhe" (o que render.go escreve). O titulo precisa existir na
// lista de itens da sessao (senao a linha vira commit/link ou ruido); com
// "**kind**" explicito, um item que so apareceu no detalhe e criado aqui.
function tryBindDetail(content: string, titles: Set<string>, items: DraftItem[]): boolean {
  const bold = boldPattern.exec(content);
  const body = bold ? bold[2].trim() : content;
  const dash = body.indexOf(dashSeparator);
  if (dash > 0) {
    const title = body.slice(0, dash).trim();
    const detail = body.slice(dash + dashSeparator.length).trim();
    if (detail) {
      if (titles.has(title)) {
        setItemDetail(items, title, detail);
        return true;
      }
      if (bold) {
        items.push({ kind: bold[1].trim(), title, detail });
        titles.add(title);
        return true;
      }
    }
  }
  const colon = /^([^:]+):\s+(.+)$/.exec(body);
  if (colon) {
    const title = colon[1].trim();
    const detail = colon[2].trim();
    if (titles.has(title) && detail && !urlPattern.test(detail)) {
      setItemDetail(items, title, detail);
      return true;
    }
  }
  return false;
}

function setItemDetail(items: DraftItem[], title: string, detail: string): void {
  const target = items.find((item) => item.title === title);
  if (target && !target.detail) {
    target.detail = detail;
  }
}

function keepFirstOf<T>(list: T[], same: (a: T, b: T) => boolean): T[] {
  return list.filter((entry, index) => list.findIndex((other) => same(other, entry)) === index);
}

type DraftCommit = { hash: string; message?: string; url?: string };
type DraftLink = { label?: string; url: string };
type DraftItem = { kind: string; title: string; detail?: string; commit?: string; url?: string };
type SessionContext = { project: string; date: string; time: string; host: string; marker?: string };
type TabbedSession = { session: LogSession; seq: number };

function assembleSession(
  context: SessionContext,
  detail: "concise" | "full",
  summary: string | undefined,
  items: DraftItem[],
  commits: DraftCommit[],
  links: DraftLink[],
  legacy: boolean,
  sessionIdTail: string,
): LogSession {
  const sessionId = [context.project, context.date, context.time, context.host, sessionIdTail].join("|");
  const cleanItems: LogItem[] = items.map((item) => ({
    kind: item.kind,
    title: item.title,
    detail: item.detail,
    commit: item.commit,
    url: item.url,
    project: context.project,
    date: context.date,
    time: context.time,
    sessionId,
  }));
  const session: LogSession = {
    project: context.project,
    date: context.date,
    time: context.time,
    host: context.host,
    detail,
    items: cleanItems,
    commits: dedupeCommits(commits),
    links: dedupeLinks(links),
    legacy,
    sessionId,
  };
  if (summary) session.summary = summary;
  if (context.marker) session.marker = context.marker;
  return session;
}

function dedupeCommits(commits: DraftCommit[]): LogCommit[] {
  const kept = commits.filter((commit) => commit.hash !== "" || nonEmpty(commit.message));
  return keepFirstOf(kept, (a, b) => a.hash === b.hash && a.message === b.message && a.url === b.url).map(
    (commit) => ({
      hash: commit.hash,
      message: commit.message,
      url: commit.url,
    }),
  );
}

function dedupeLinks(links: DraftLink[]): LogLink[] {
  const kept = links.filter((link) => nonEmpty(link.url));
  return keepFirstOf(kept, (a, b) => (a.label ?? "") === (b.label ?? "") && a.url === b.url).map(
    (link) => ({
      label: link.label,
      url: link.url,
    }),
  );
}

// Le todas as sessoes de uma nota, na ordem em que aparecem no arquivo.
// Fence valido vira sessao; sem fence valido, o bloco humano e lido legado
// (Mobile nao guarda formato, e leitura nunca escrita).
function readNoteSessions(markdown: string, projectFallback: string): TabbedSession[] {
  const out: TabbedSession[] = [];
  if (typeof markdown !== "string" || markdown.trim() === "") return out;
  const lines = splitLines(markdown);
  const headerAt: number[] = [];
  lines.forEach((line, index) => {
    if (headerPattern.test(line)) headerAt.push(index);
  });
  if (headerAt.length === 0) {
    // Sem cabecalho legado nenhum: ainda assim todo fence valido vale sessao.
    readOrphanFences(lines, out);
    return out;
  }
  headerAt.forEach((start, order) => {
    const end = order + 1 < headerAt.length ? headerAt[order + 1] : lines.length;
    readBlockSessions(lines.slice(start, end), projectFallback, out);
  });
  return out;
}

// Le um bloco de sessao (um cabecalho ate o proximo). O fence canonico vence;
// sem fence valido (ausente, sem fechamento ou JSON quebrado) o bloco humano
// humano e lido pelo formato legado, sem explodir e sem perder o resto.
function readBlockSessions(blockLines: string[], projectFallback: string, out: TabbedSession[]): void {
  const header = headerPattern.exec(blockLines[0]);
  if (!header) return;
  const context: SessionContext = {
    project: projectFallback,
    date: header[1],
    time: header[2],
    host: header[3].trim(),
  };
  context.marker = findMarker(blockLines);
  const spans = findFenceSpans(blockLines, 1);
  let sawValidFence = false;
  for (const span of spans) {
    const raw = blockLines.slice(span.open + 1, span.close).join("\n").trim();
    const session = readFenceSession(raw, context);
    if (session) {
      out.push({ session, seq: span.open });
      sawValidFence = true;
    }
  }
  if (spans.length === 0 || !sawValidFence) {
    out.push({ session: readLegacyBlock(blockLines, 1, spans, context), seq: 0 });
  }
}

type FenceSpan = { open: number; close: number };

// Fence sem fechamento fica com close = -1 e se estende ate o fim do bloco
// (o corte de bloco ja acontece no proximo cabecalho de sessao).
function findFenceSpans(lines: string[], from: number): FenceSpan[] {
  const spans: FenceSpan[] = [];
  let index = from;
  while (index < lines.length) {
    if (!fenceOpenPattern.test(lines[index])) {
      index += 1;
      continue;
    }
    let close = -1;
    for (let scan = index + 1; scan < lines.length; scan += 1) {
      if (fenceClosePattern.test(lines[scan])) {
        close = scan;
        break;
      }
    }
    spans.push({ open: index, close });
    if (close < 0) break;
    index = close + 1;
  }
  return spans;
}

// Le o corpo humano no formato legado (doc painel de historico): resumo ate a
// primeira lista, itens, depois o ":::details" com detalhes por itemtitulo,
// commits nao mostrados junto do item e links.
function readLegacyBlock(
  blockLines: string[],
  from: number,
  spans: FenceSpan[],
  context: SessionContext,
): LogSession {
  const hidden = new Set<number>();
  for (const span of spans) {
    const wall = span.close < 0 ? blockLines.length : span.close + 1;
    for (let index = span.open; index < wall; index += 1) hidden.add(index);
  }
  let inDetails = false;
  let section: "concise" | "commits" | "links" = "concise";
  let sawList = false;
  let detailsOpen = false;
  const summary: string[] = [];
  const items: DraftItem[] = [];
  const commits: DraftCommit[] = [];
  const links: DraftLink[] = [];
  const titles = new Set<string>();

  for (let index = from; index < blockLines.length; index += 1) {
    if (hidden.has(index)) continue;
    const text = blockLines[index].trim();
    if (!text) continue;
    if (markerPattern.test(text)) continue;
    if (!inDetails && /^:::details\b/.test(text)) {
      inDetails = true;
      section = "concise";
      detailsOpen = detailsOpenStatePattern.test(text);
      continue;
    }
    if (inDetails && detailsClosePattern.test(text)) {
      inDetails = false;
      section = "concise";
      continue;
    }
    if (inDetails) {
      if (/^Commits?:?\s*$/i.test(text)) {
        section = "commits";
        continue;
      }
      if (/^Links?:?\s*$/i.test(text)) {
        section = "links";
        continue;
      }
      const list = listLinePattern.exec(text);
      if (!list) continue;
      readDetailLine(list[1].trim(), section, titles, items, commits, links);
      continue;
    }
    const item = readItemLine(text);
    if (item) {
      sawList = true;
      items.push(item);
      titles.add(item.title);
      continue;
    }
    const list = listLinePattern.exec(text);
    if (list) {
      // Sem itens, o corpo visivel so tem commits ou links.
      sawList = true;
      pushBare(readCommitOrLink(list[1].trim()), commits, links);
      continue;
    }
    if (!sawList) {
      summary.push(text);
    }
  }
  return assembleSession(
    context,
    detailsOpen ? "full" : "concise",
    summary.length > 0 ? summary.join("\n") : undefined,
    items,
    commits,
    links,
    true,
    context.marker ?? "",
  );
}

function readDetailLine(
  content: string,
  section: "concise" | "commits" | "links",
  titles: Set<string>,
  items: DraftItem[],
  commits: DraftCommit[],
  links: DraftLink[],
): void {
  if (section === "concise" && tryBindDetail(content, titles, items)) {
    return;
  }
  pushBare(readCommitOrLink(content), commits, links);
}

function pushBare(read: BareRead | null, commits: DraftCommit[], links: DraftLink[]): void {
  if (!read) return;
  if (read.type === "commit") {
    if (read.hash || read.message) {
      commits.push({ hash: read.hash, message: read.message, url: read.url });
    }
    return;
  }
  links.push({ label: read.label, url: read.url });
}

function findMarker(lines: string[]): string | undefined {
  for (const line of lines) {
    const match = markerPattern.exec(line);
    if (match) return match[1];
  }
  return undefined;
}

// Fences soltos (a nota sem cabecalho legado): cada um valido vira sessao,
// amarrando project/date/time/host do proprio payload.
function readOrphanFences(lines: string[], out: TabbedSession[]): void {
  const spans = findFenceSpans(lines, 0);
  for (const span of spans) {
    if (span.close < 0) break;
    const raw = lines.slice(span.open + 1, span.close).join("\n").trim();
    const session = readFenceSession(raw, { project: "", date: "", time: "", host: "" });
    if (session) out.push({ session, seq: span.open });
  }
}

// Le o payload do fence campo a campo: campos desconhecidos sao ignorados e
// arrays podem faltar; um fence sem v/project/date/time/host ou JSON invalido
// nao vale sessao. Detalhe "full" pode chegar como "concise" corrupto: cai.
function readFenceSession(raw: string, context: SessionContext): LogSession | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  if (typeof data.v !== "number") return null;
  if (
    !nonEmpty(data.project) ||
    !nonEmpty(data.date) ||
    !nonEmpty(data.time) ||
    !nonEmpty(data.host)
  ) {
    return null;
  }
  const detail = data.detail === "full" ? "full" : "concise";
  const summary = nonEmpty(data.summary) ? data.summary : undefined;
  const items: DraftItem[] = [];
  if (Array.isArray(data.items)) {
    for (const entry of data.items) {
      if (!isRecord(entry) || !nonEmpty(entry.title)) continue;
      items.push({
        kind: nonEmpty(entry.kind) ? entry.kind : "",
        title: entry.title,
        detail: nonEmpty(entry.detail) ? entry.detail : undefined,
        commit: nonEmpty(entry.commit) ? entry.commit : undefined,
        url: nonEmpty(entry.url) ? entry.url : undefined,
      });
    }
  }
  const commits: DraftCommit[] = [];
  if (Array.isArray(data.commits)) {
    for (const entry of data.commits) {
      if (!isRecord(entry)) continue;
      const hash = nonEmpty(entry.hash) ? entry.hash : "";
      const message = nonEmpty(entry.message) ? entry.message : undefined;
      const url = nonEmpty(entry.url) ? entry.url : undefined;
      if (!hash && !message) continue;
      commits.push({ hash, message, url });
    }
  }
  const links: DraftLink[] = [];
  if (Array.isArray(data.links)) {
    for (const entry of data.links) {
      if (!isRecord(entry) || !nonEmpty(entry.url)) continue;
      links.push({ label: nonEmpty(entry.label) ? entry.label : undefined, url: entry.url });
    }
  }
  const fenceTail = context.marker ?? stableHash(raw);
  return assembleSession(
    {
      project: data.project,
      date: data.date,
      time: data.time,
      host: data.host,
      ...(context.marker ? { marker: context.marker } : {}),
    },
    detail,
    summary,
    items,
    commits,
    links,
    false,
    fenceTail,
  );
}

function newerFirst(a: TabbedSession, b: TabbedSession): number {
  const keyA = `${a.session.date}T${a.session.time}`;
  const keyB = `${b.session.date}T${b.session.time}`;
  if (keyA !== keyB) {
    return keyA > keyB ? -1 : 1;
  }
  // Empate de data+hora: quem aparece depois no arquivo foi registrada depois.
  return b.seq - a.seq;
}

function dedupe(sorted: TabbedSession[]): LogSession[] {
  const seen = new Set<string>();
  const out: LogSession[] = [];
  for (const entry of sorted) {
    if (seen.has(entry.session.sessionId)) continue;
    seen.add(entry.session.sessionId);
    out.push(entry.session);
  }
  return out;
}

function sortSessions(list: TabbedSession[]): TabbedSession[] {
  const copy = [...list];
  copy.sort(newerFirst);
  return copy;
}

// Le o corpo de uma nota do caderno Projetos. `project` e o nome da entry e
// preenche as sessoes que nao trazem projeto no payload (legado).
export function parseProjectLog(markdown: string, project?: string): LogSession[] {
  if (typeof markdown !== "string") return [];
  return dedupe(sortSessions(readNoteSessions(markdown, project ?? "")));
}

// Le varias notas do caderno: mesmo indice, project resolvido por note id.
export function parseProjectLogs(
  notes: Array<{ id: string; body: string }>,
  projectByNoteId?: Record<string, string>,
): LogSession[] {
  if (!Array.isArray(notes)) return [];
  const combined: TabbedSession[] = [];
  let offset = 0;
  for (const note of notes) {
    if (!isRecord(note as unknown)) continue;
    const body = typeof note.body === "string" ? note.body : "";
    const fallback = projectByNoteId?.[note.id] ?? "";
    for (const entry of readNoteSessions(body, fallback)) {
      combined.push({ session: entry.session, seq: entry.seq + offset });
    }
    offset += 1e6;
  }
  return dedupe(sortSessions(combined));
}

// Remove os fences dyarium-json para exibicao, preservando o resto do
// markdown byte a byte: apaga da direita para a esquerda e colapsa a linha em
// branco que sobraria ("texto \n\n fence \n\n texto" -> "texto \n\n texto").
export function stripLogFences(markdown: string): string {
  if (typeof markdown !== "string") return "";
  let result = markdown;
  const removals = fenceRemovals(markdown);
  for (let index = removals.length - 1; index >= 0; index -= 1) {
    const span = removals[index];
    const before = result.slice(0, span.start);
    const after = result.slice(span.end);
    let trailing = 0;
    while (trailing < before.length && before.charAt(before.length - 1 - trailing) === "\n") {
      trailing += 1;
    }
    let leading = 0;
    while (leading < after.length && after.charAt(leading) === "\n") {
      leading += 1;
    }
    const keep = Math.min(2, trailing + leading);
    result =
      before.slice(0, before.length - trailing) + "\n".repeat(keep) + after.slice(leading);
  }
  return result;
}

function fenceRemovals(markdown: string): Array<{ start: number; end: number }> {
  const removals: Array<{ start: number; end: number }> = [];
  const lines = markdown.split("\n");
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }
  let index = 0;
  while (index < lines.length) {
    if (!fenceOpenPattern.test(lines[index])) {
      index += 1;
      continue;
    }
    let close = -1;
    for (let scan = index + 1; scan < lines.length; scan += 1) {
      if (fenceClosePattern.test(lines[scan])) {
        close = scan;
        break;
      }
    }
    const start = lineStarts[index];
    let end: number;
    let stopLine = -1;
    if (close >= 0) {
      end = close + 1 < lines.length ? lineStarts[close + 1] : offset - 1;
    } else {
      stopLine = lines.length;
      for (let scan = index + 1; scan < lines.length; scan += 1) {
        if (headerPattern.test(lines[scan])) {
          stopLine = scan;
          break;
        }
      }
      end = stopLine < lines.length ? lineStarts[stopLine] : offset - 1;
    }
    removals.push({ start, end });
    if (close < 0) {
      index = Math.max(stopLine, index + 1);
    } else {
      index = close + 1;
    }
  }
  return removals;
}

export function itemKindCounts(items: LogItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  if (!Array.isArray(items)) return counts;
  for (const item of items) {
    if (!item || typeof item.kind !== "string") continue;
    counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  }
  return counts;
}

// Agrupa sessoes ja lidas: dedupe por sessionId e ordena da mais nova para a
// mais antiga; sessao sem item e mantida.
export function groupBySession(sessions: LogSession[]): LogSession[] {
  if (!Array.isArray(sessions)) return [];
  const tabbed = sessions.filter(Boolean).map((session, seq) => ({ session, seq }));
  return dedupe(sortSessions(tabbed));
}
