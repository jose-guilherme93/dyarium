import {
  buildProjectTree,
  daySeries,
  folderAggregate,
  groupBySession,
  itemKindCounts,
  parseProjectLog,
  parseProjectLogs,
  parseSessionNote,
  stripLogFences,
  type LogItem,
  type LogSession,
} from '../projetoLog';

const fenceOpen = "```dyarium-json";
const fenceClose = "```";
const fence = (payload: string) => [fenceOpen, payload, fenceClose].join("\n");

// Contrato v2 (docs/projetos.md): uma sessao por nota, maquina + caminho.
const sessionPayload = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    v: 2,
    kind: "session",
    machine: "work-notebook",
    path: "/home/joseti/projects/syncwin",
    session: "ses_abc",
    state: "open",
    opened: "2026-11-14T09:12:00Z",
    date: "2026-11-14",
    time: "09:12",
    summary: "Resumo da sessao.",
    items: [
      { kind: "feat", title: "parser", detail: "fence v2", commit: "abc1234" },
      { kind: "test", title: "suite" },
    ],
    commits: [
      { hash: "def5678", message: "commit extra", url: "https://example.com/commit/def5678" },
    ],
    links: [{ label: "spec", url: "https://example.com/spec" }],
    ...overrides,
  });

// Nota como o dashboard entrega (content_markdown + updated_at).
const sessionNote = (
  payload: string,
  updated: string | null = "2026-11-14T17:20:00Z",
  id = "note-session",
) => ({
  id,
  entry_id: "entry-1",
  content_markdown: fence(payload),
  updated_at: updated,
});

const sessionId = "work-notebook|/home/joseti/projects/syncwin|ses_abc";
const SESSION_NOW = Date.parse("2026-11-14T22:00:00Z");

const fullPayload = JSON.stringify({
  v: 1,
  project: "dyarium",
  date: "2026-11-09",
  time: "14:58",
  host: "vps-dev",
  detail: "full",
  summary: "Resumo objetivo da sessao.",
  items: [
    {
      kind: "feat",
      title: "servidor mcp",
      detail: "detalhe do item",
      commit: "abc1234",
      url: "https://example.com/commit/abc1234",
    },
    { kind: "test", title: "suite verde" },
  ],
  commits: [{ hash: "def5678", message: "commit extra", url: "https://example.com/commit/def5678" }],
  links: [{ label: "spec", url: "https://example.com/spec" }],
});

const fullBlock = [
  "## 2026-11-09 14:58 · vps-dev",
  "",
  "Resumo objetivo da sessao.",
  "",
  "- **feat** servidor mcp · [abc1234](https://example.com/commit/abc1234)",
  "- **test** suite verde",
  "",
  ":::details open Detalhes técnicos",
  "- servidor mcp: detalhe do item",
  "",
  "def5678 — commit extra https://example.com/commit/def5678",
  "",
  "[spec](https://example.com/spec)",
  ":::",
  "",
  fence(fullPayload),
  "",
  "<!-- mcp:0123456789ab -->",
].join("\n");

describe("bloco moderno (fence dyarium-json)", () => {
  it("le todos os campos do fence completo, inclusive item com detail/commit/url", () => {
    const sessions = parseProjectLog(fullBlock, "nome-da-entry");
    expect(sessions).toHaveLength(1);
    const session = sessions[0];
    expect(session.project).toEqual("dyarium");
    expect(session.date).toEqual("2026-11-09");
    expect(session.time).toEqual("14:58");
    expect(session.host).toEqual("vps-dev");
    expect(session.detail).toEqual("full");
    expect(session.summary).toEqual("Resumo objetivo da sessao.");
    expect(session.legacy).toBe(false);
    expect(session.marker).toEqual("0123456789ab");
    expect(session.sessionId).toEqual("dyarium|2026-11-09|14:58|vps-dev|0123456789ab");
    expect(session.items).toHaveLength(2);
    expect(session.items[0]).toEqual({
      kind: "feat",
      title: "servidor mcp",
      detail: "detalhe do item",
      commit: "abc1234",
      url: "https://example.com/commit/abc1234",
      project: "dyarium",
      date: "2026-11-09",
      time: "14:58",
      sessionId: session.sessionId,
    });
    expect(session.items[1]).toEqual({
      kind: "test",
      title: "suite verde",
      detail: undefined,
      commit: undefined,
      url: undefined,
      project: "dyarium",
      date: "2026-11-09",
      time: "14:58",
      sessionId: session.sessionId,
    });
    expect(session.commits).toEqual([
      { hash: "def5678", message: "commit extra", url: "https://example.com/commit/def5678" },
    ]);
    expect(session.links).toEqual([{ label: "spec", url: "https://example.com/spec" }]);
  });

  it("le <, &, aspas e acento do fence sem alterar o texto original", () => {
    const payload = JSON.stringify({
      v: 1,
      project: 'Dy <b> & "X" ção',
      date: "2026-11-09",
      time: "10:00",
      host: "h & <y>",
      detail: "concise",
      summary: 'custo < 10 & "aspas" — ação',
      items: [{ kind: "feat", title: 'tag <b> & "fim" é' }],
    });
    const block = ["## 2026-11-09 10:00 · host", "", fence(payload), "", "<!-- mcp:k1 -->"].join("\n");
    const sessions = parseProjectLog(block, "entry");
    expect(sessions).toHaveLength(1);
    expect(sessions[0].project).toEqual('Dy <b> & "X" ção');
    expect(sessions[0].host).toEqual("h & <y>");
    expect(sessions[0].summary).toEqual('custo < 10 & "aspas" — ação');
    expect(sessions[0].items[0].title).toEqual('tag <b> & "fim" é');
  });

  it("ignora campo desconhecido e le v maior que 1", () => {
    const payload = JSON.stringify({
      v: 2,
      project: "p",
      date: "2026-11-09",
      time: "08:00",
      host: "h",
      detail: "full",
      futuro: { dado: "novo" },
      items: [{ kind: "chore", title: "t", novidade: 1 }],
    });
    const block = ["## 2026-11-09 08:00 · h", "", fence(payload)].join("\n");
    const sessions = parseProjectLog(block);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].detail).toEqual("full");
    expect(sessions[0].items).toEqual([expect.objectContaining({ kind: "chore", title: "t" })]);
  });

  it("fence sem fechamento ou JSON invalido nao explode e nao vira sessao", () => {
    const semFechamento = [
      "## 2026-11-05 08:00 · host-um",
      "",
      "- **feat** um · commitum",
      "",
      fenceOpen,
      '{"v":1,"project":"x"',
    ].join("\n");
    const jsonQuebrado = [
      "## 2026-11-06 09:00 · host-dois",
      "",
      fenceOpen,
      '{"v":1,"project":',
      fenceClose,
      "",
      "- **fix** dois · commitdois",
    ].join("\n");
    const note = [semFechamento, "", jsonQuebrado].join("\n\n");
    let sessions: LogSession[] = [];
    expect(() => {
      sessions = parseProjectLog(note, "entry");
    }).not.toThrow();
    expect(sessions).toHaveLength(2);
    // Nenhuma sessao nasceu do fence; as duas vieram do bloco humano.
    expect(sessions.map((session) => session.legacy)).toEqual([true, true]);
    expect(sessions[0].date).toEqual("2026-11-06");
    expect(sessions[0].items[0].title).toEqual("dois");
    expect(sessions[1].date).toEqual("2026-11-05");
    expect(sessions[1].items[0].title).toEqual("um");
  });
});

describe("bloco legado (sem fence)", () => {
  const legacyFechado = [
    "## 2026-11-09 09:20 · legado-a",
    "",
    "Resumo legado A.",
    "",
    "- **feat** listener · [abc1234](https://example.com/commit/abc1234)",
    "- **fix** bug vazio",
    "",
    ":::details Detalhes técnicos",
    "- listener: bit de paridade errado",
    "- bug vazio: moldura duoria ignorada",
    ":::",
  ].join("\n");

  const legacyAberto = [
    "## 2026-11-08 16:40 · legado-b",
    "",
    "Resumo legado B.",
    "",
    "- **perf** pan do relatorio",
    "",
    ":::details open Detalhes técnicos",
    "- **perf** pan do relatorio — medida no quadro",
    "- bcdef01 — commit manual",
    "- [qa](https://example.com/qa)",
    ":::",
  ].join("\n");

  it("le formato legado fechado e aberto, item com e sem commit", () => {
    const note = [legacyFechado, "", legacyAberto].join("\n\n");
    const sessions = parseProjectLog(note, "dyarium");
    expect(sessions).toHaveLength(2);
    const [fechado, aberto] = sessions;
    expect(fechado.legacy).toBe(true);
    expect(aberto.legacy).toBe(true);
    expect(fechado.date).toEqual("2026-11-09");
    expect(fechado.host).toEqual("legado-a");
    expect(fechado.detail).toEqual("concise");
    expect(fechado.summary).toEqual("Resumo legado A.");
    expect(fechado.items[0]).toEqual(
      expect.objectContaining({
        kind: "feat",
        title: "listener",
        commit: "abc1234",
        url: "https://example.com/commit/abc1234",
      }),
    );
    expect(fechado.items[0].detail).toEqual("bit de paridade errado");
    expect(fechado.items[1]).toEqual(
      expect.objectContaining({ kind: "fix", title: "bug vazio", detail: "moldura duoria ignorada" }),
    );
    expect(fechado.items[1].commit).toBeUndefined();
    // Sem marcador e sem fence, a identidade termina vazia.
    expect(fechado.sessionId).toEqual("dyarium|2026-11-09|09:20|legado-a|");
    expect(aberto.detail).toEqual("full");
    expect(aberto.items[0].detail).toEqual("medida no quadro");
    expect(aberto.commits).toEqual([{ hash: "bcdef01", message: "commit manual" }]);
    expect(aberto.links).toEqual([{ label: "qa", url: "https://example.com/qa" }]);
  });

  it("le hash+mensagem sem cabecalho de secao e link de url pura", () => {
    const note = [
      "## 2026-11-06 09:00 · host-separado",
      "",
      "- abc1234 — segunda troca",
      "- https://example.com/so-url",
      "",
      ":::details open Detalhes técnicos",
      "- **fix** degelo — sem varizar",
      ":::",
    ].join("\n");
    const sessions = parseProjectLog(note, "dy");
    expect(sessions).toHaveLength(1);
    expect(sessions[0].items[0].detail).toEqual("sem varizar");
    expect(sessions[0].commits).toEqual([{ hash: "abc1234", message: "segunda troca" }]);
    expect(sessions[0].links).toEqual([{ url: "https://example.com/so-url" }]);
    expect(sessions[0].detail).toEqual("full");
  });

  it("JSON quebrado num bloco novo cai para leitura humana sem poluir as outras", () => {
    const blocoQuebrado = [
      "## 2026-11-09 10:30 · legado-c",
      "",
      fenceOpen,
      '{"v":1',
      fenceClose,
    ].join("\n");
    const note = [legacyFechado, "", blocoQuebrado].join("\n\n");
    const sessions = parseProjectLog(note, "dyarium");
    expect(sessions).toHaveLength(2);
    expect(sessions[0].sessionId).toEqual("dyarium|2026-11-09|10:30|legado-c|");
    expect(sessions[0].items).toHaveLength(0);
    expect(sessions[1].items).toHaveLength(2);
  });
});

describe("sessao sem item", () => {
  it("bloco sem itens guarda so commits e links", () => {
    const note = [
      "## 2026-11-07 09:12 · host-c",
      "",
      "- def5678 commit extra https://example.com/commit/def5678",
      "- spec: https://example.com/spec",
    ].join("\n");
    const sessions = parseProjectLog(note, "dyarium");
    expect(sessions).toHaveLength(1);
    expect(sessions[0].items).toHaveLength(0);
    expect(sessions[0].commits).toEqual([
      { hash: "def5678", message: "commit extra", url: "https://example.com/commit/def5678" },
    ]);
    expect(sessions[0].links).toEqual([{ label: "spec", url: "https://example.com/spec" }]);
  });
});

describe("ordem e duplicata", () => {
  const antigo = [
    "## 2026-11-08 16:40 · legado-b",
    "",
    "Resumo antigo.",
    "",
    "- **perf** pan do relatorio",
  ].join("\n");
  const meio = [
    "## 2026-11-09 09:20 · legado-a",
    "",
    "Resumo meio.",
    "",
    "- **feat** listener · abc1234",
  ].join("\n");

  it("tres sessoes na nota saem da mais nova para a mais antiga", () => {
    // A ordem do arquivo e cronologica: o que o caderno anexou por ultimo
    // esta embaixo, e o indice le de cima para baixo.
    const note = [antigo, meio, fullBlock].join("\n\n");
    const sessions = parseProjectLog(note, "dyarium");
    expect(sessions.map((session) => session.time)).toEqual(["14:58", "09:20", "16:40"]);
    expect(sessions.map((session) => session.legacy)).toEqual([false, true, true]);
    expect(sessions[1].items[0].commit).toEqual("abc1234");
  });

  it("duplicata exata (mesmo marcador) entra uma vez so", () => {
    const block = [
      "## 2026-11-09 22:10 · vps-dev",
      "",
      fence(
        '{"v":1,"project":"p","date":"2026-11-09","time":"22:10","host":"vps-dev","detail":"concise"}',
      ),
      "",
      "<!-- mcp:cafe123 -->",
    ].join("\n");
    const note = [block, block].join("\n\n");
    const sessions = parseProjectLog(note);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].marker).toEqual("cafe123");
  });
});

describe("stripLogFences", () => {
  it("preserva todo o resto byte a byte e tira so o fence", () => {
    const beforeFence = [
      "titulo da nota",
      "",
      "## 2026-11-09 14:58 · vps-dev",
      "",
      "resumo livre",
      "",
      "- **feat** item a · [abc1234](https://example.com/commit/abc1234)",
      "",
      ":::details Detalhes técnicos",
      "- item a: detalhe rabiscado",
      ":::",
      "",
    ].join("\n");
    const afterFence = [
      "",
      "<!-- mcp:0123456789ab -->",
      "",
      "segundo paragrafo livre",
      "",
      "blocos normais ficam",
    ].join("\n");
    const note = beforeFence + "\n" + fence(fullPayload) + afterFence;
    // O fence sai com as duas linhas em branco que ele criou: sobra uma so.
    const expected = beforeFence + "\n" + afterFence.slice(1);
    const result = stripLogFences(note);
    expect(result).toEqual(expected);
    expect(result.includes("dyarium-json")).toBe(false);
    expect(result.includes("- **feat** item a")).toBe(true);
  });

  it("fence quebrado (sem fechamento) tambem sai da exibicao", () => {
    const note = [
      "## 2026-11-05 08:00 · host-um",
      "",
      "- **feat** um · commitum",
      "",
      fenceOpen,
      '{"v":1,"project":"x"',
      "",
      "## 2026-11-06 09:00 · host-dois",
      "",
      "texto livre depois",
    ].join("\n");
    const result = stripLogFences(note);
    expect(result.includes("dyarium-json")).toBe(false);
    expect(result.includes('"project":"x"')).toBe(false);
    expect(result.includes("- **feat** um · commitum")).toBe(true);
    expect(result.includes("texto livre depois")).toBe(true);
  });

  it("texto sem nenhum fence retorna igual", () => {
    const plain = ["# nota", "", "so um paragrafo simples", "", "mais um"].join("\n");
    expect(stripLogFences(plain)).toEqual(plain);
  });
});

describe("nota inteira sem sessao", () => {
  it("devolve array vazio e nao explode", () => {
    const plain = ["# pagina", "", "paragrafo qualquer", ""].join("\n");
    expect(parseProjectLog(plain, "entry")).toEqual([]);
    expect(parseProjectLogs([{ id: "n1", body: plain }], { n1: "entry" })).toEqual([]);
  });
});

describe("parseProjectLogs", () => {
  it("une notas e nomeia o projeto pelo id da entry", () => {
    const antigo = "## 2026-11-08 16:40 · host-b\n\nResumo antigo.\n";
    const meio = "## 2026-11-09 09:20 · host-a\n\n- **feat** listener · abc1234\n";
    const notes = [
      { id: "entry-dy", body: fullBlock },
      { id: "outro", body: [antigo, meio].join("\n\n") },
    ];
    const sessions = parseProjectLogs(notes, { "entry-dy": "dyarium", outro: "outro-projeto" });
    expect(sessions).toHaveLength(3);
    expect(sessions.map((session) => session.time)).toEqual(["14:58", "09:20", "16:40"]);
    expect(sessions[0].project).toEqual("dyarium");
    expect(sessions[1].project).toEqual("outro-projeto");
    expect(sessions[2].project).toEqual("outro-projeto");
  });
});

describe("groupBySession e itemKindCounts", () => {
  it("deduplica, ordena e mantem sessao sem item", () => {
    const note = [
      "## 2026-11-08 16:40 · legado-b",
      "",
      "- **perf** pan do relatorio",
    ].join("\n");
    const sessions = parseProjectLog(note, "dyarium");
    const semItem: LogSession = {
      ...sessions[0],
      time: "23:00",
      sessionId: "dyarium|2026-11-09|23:00|legado-b|extra",
      items: [],
    };
    const grouped = groupBySession([
      semItem,
      sessions[0],
      // Sessao sem item (so commits) fica na lista.
      {
        project: "dyarium",
        date: "2026-11-07",
        time: "08:00",
        host: "host-c",
        detail: "concise",
        items: [],
        commits: [],
        links: [],
        legacy: true,
        sessionId: "dyarium|2026-11-07|08:00|host-c|",
      },
    ]);
    expect(grouped.map((session) => session.sessionId)).toEqual([
      "dyarium|2026-11-09|23:00|legado-b|extra",
      "dyarium|2026-11-08|16:40|legado-b|",
      "dyarium|2026-11-07|08:00|host-c|",
    ]);
    // Sessao de so-commits (sem item) fica mantida.
    expect(grouped[2].items).toHaveLength(0);
  });

  it("conta itens por kind", () => {
    const antigo = "## 2026-11-08 16:40 · legado-b\n\n- **perf** pan do relatorio\n";
    const meio = "## 2026-11-09 09:20 · legado-a\n\n- **feat** listener · abc1234\n- **feat** outro item\n";
    const note = [antigo, meio, fullBlock].join("\n\n");
    const sessions = parseProjectLog(note, "dyarium");
    const flat = sessions.flatMap((session) => session.items);
    expect(itemKindCounts(flat)).toEqual({ feat: 3, test: 1, perf: 1 });
  });
});

describe("parseSessionNote (fence v2)", () => {
  it("le o fence v2 completo e mantem itens, commits e links", () => {
    const session = parseSessionNote(sessionNote(sessionPayload()), SESSION_NOW);
    expect(session).not.toBeNull();
    expect(session).toEqual(
      expect.objectContaining({
        v: 2,
        kind: "session",
        machine: "work-notebook",
        path: "/home/joseti/projects/syncwin",
        session: "ses_abc",
        fenceState: "open",
        state: "open",
        opened: "2026-11-14T09:12:00Z",
        date: "2026-11-14",
        time: "09:12",
        summary: "Resumo da sessao.",
      }),
    );
    expect(session?.id).toEqual(sessionId);
    expect(session?.items).toHaveLength(2);
    expect(session?.items[0]).toEqual(
      expect.objectContaining({
        kind: "feat",
        title: "parser",
        detail: "fence v2",
        commit: "abc1234",
        project: "syncwin",
        date: "2026-11-14",
        time: "09:12",
        sessionId,
      }),
    );
    expect(session?.items[1]).toEqual(
      expect.objectContaining({ kind: "test", title: "suite" }),
    );
    expect(session?.commits).toEqual([
      { hash: "def5678", message: "commit extra", url: "https://example.com/commit/def5678" },
    ]);
    expect(session?.links).toEqual([{ label: "spec", url: "https://example.com/spec" }]);
  });

  it("le a nota do app (text + updatedAt) e deriva o estado sem Date.now", () => {
    const note = { id: "rec-1", text: fence(sessionPayload()), updatedAt: "2026-11-14T10:00:00Z" };
    const session = parseSessionNote(note, Date.parse("2026-11-14T23:00:00Z"));
    expect(session?.state).toEqual("interrupted");
    // O mesmo payload com now proximo da atualizacao continua aberto.
    expect(parseSessionNote(note, Date.parse("2026-11-14T11:00:00Z"))?.state).toEqual("open");
  });

  it("ignora campo desconhecido do fence e do item", () => {
    const payload = sessionPayload({
      futuro: { dado: "novo" },
      meta: [1, 2, 3],
      items: [{ kind: "chore", title: "t", novidade: 1 }],
    });
    const session = parseSessionNote(sessionNote(payload), SESSION_NOW);
    expect(session).not.toBeNull();
    expect(session?.items).toEqual([expect.objectContaining({ kind: "chore", title: "t" })]);
  });

  it("fence malformado, v1 ou corpo vazio nao viram sessao e nao explodem", () => {
    const semFechamento = {
      id: "n1",
      content_markdown: [fenceOpen, sessionPayload()].join("\n"),
      updated_at: "2026-11-14T10:00:00Z",
    };
    const jsonQuebrado = {
      id: "n2",
      content_markdown: fence('{"v":2,"kind":"session"'),
      updated_at: "2026-11-14T10:00:00Z",
    };
    const v1 = { id: "n3", content_markdown: fullBlock, updated_at: "2026-11-14T10:00:00Z" };
    expect(() => parseSessionNote(jsonQuebrado, SESSION_NOW)).not.toThrow();
    expect(parseSessionNote(semFechamento, SESSION_NOW)).toBeNull();
    expect(parseSessionNote(jsonQuebrado, SESSION_NOW)).toBeNull();
    expect(parseSessionNote(v1, SESSION_NOW)).toBeNull();
    expect(parseSessionNote({ id: "n4", content_markdown: "" }, SESSION_NOW)).toBeNull();
    expect(parseSessionNote(null, SESSION_NOW)).toBeNull();
  });

  it("state ausente rejeita; closed so vale quando a sessao fechou", () => {
    const semState = sessionPayload({ state: undefined });
    expect(parseSessionNote(sessionNote(semState), SESSION_NOW)).toBeNull();

    const fechadaSemData = sessionPayload({ state: "closed", closed: undefined });
    const fechada = parseSessionNote(sessionNote(fechadaSemData), SESSION_NOW);
    expect(fechada?.state).toEqual("closed");
    expect(fechada?.fenceState).toEqual("closed");
    expect(fechada?.closed).toBeUndefined();

    const abertaComData = sessionPayload({ state: "open", closed: "2026-11-14T10:00:00Z" });
    const aberta = parseSessionNote(sessionNote(abertaComData), SESSION_NOW);
    expect(aberta?.state).toEqual("open");
    expect(aberta?.closed).toBeUndefined();
  });

  it("interrompe so depois de 12h sem atividade, respeitando o now injetado", () => {
    const at = (updated: string | null) =>
      parseSessionNote(sessionNote(sessionPayload(), updated), SESSION_NOW)?.state;

    // 11h59 antes de now (22:00): continua aberta.
    expect(at("2026-11-14T10:01:00Z")).toEqual("open");
    // Exatamente 12h: o limite e "mais de 12h", ainda aberta.
    expect(at("2026-11-14T10:00:00Z")).toEqual("open");
    // 12h01: interrompida.
    expect(at("2026-11-14T09:59:00Z")).toEqual("interrupted");
    // Sem data de atualizacao nao ha como derivar: fica aberta.
    expect(at(null)).toEqual("open");

    // Fechada continua fechada mesmo velha.
    const velha = sessionNote(
      sessionPayload({ state: "closed", closed: "2026-11-14T09:30:00Z" }),
      "2026-11-01T00:00:00Z",
    );
    expect(parseSessionNote(velha, SESSION_NOW)?.state).toEqual("closed");
  });
});

describe("buildProjectTree", () => {
  const entries = [{ id: "entry-1", title: "Projetos" }];
  const noteOf = (id: string, payload: string, updated: string, entryId = "entry-1") => ({
    id,
    entry_id: entryId,
    content_markdown: fence(payload),
    updated_at: updated,
  });
  const at = (overrides: Record<string, unknown>) => sessionPayload(overrides);

  it("o mesmo caminho em maquinas diferentes sao dois nos, maquinas em ordem", () => {
    const notes = [
      noteOf(
        "beta-1",
        at({ machine: "beta", session: "s-beta", opened: "2026-11-14T09:00:00Z" }),
        "2026-11-14T10:00:00Z",
      ),
      noteOf(
        "alfa-1",
        at({ machine: "alfa", session: "s-alfa", opened: "2026-11-14T11:00:00Z" }),
        "2026-11-14T12:00:00Z",
      ),
    ];
    const tree = buildProjectTree({ entries, notes, now: SESSION_NOW });
    expect(tree.machines.map((machine) => machine.machine)).toEqual(["alfa", "beta"]);
    expect(tree.machines[0].sessions).toHaveLength(1);
    expect(tree.machines[1].sessions).toHaveLength(1);
    expect(tree.machines[0].sessions[0].path).toEqual("/home/joseti/projects/syncwin");
    expect(tree.machines[1].sessions[0].path).toEqual("/home/joseti/projects/syncwin");
    expect(tree.count).toEqual(2);
  });

  it("pasta so com 2+ sessoes; sessao unica fica solta com o caminho", () => {
    const notes = [
      noteOf(
        "a1",
        at({ machine: "work", session: "s1", date: "2026-11-10", time: "09:00" }),
        "2026-11-10T10:00:00Z",
      ),
      noteOf(
        "a2",
        at({ machine: "work", session: "s2", date: "2026-11-14", time: "09:00" }),
        "2026-11-14T10:00:00Z",
      ),
      noteOf(
        "b1",
        at({ machine: "work", path: "/srv/outro", session: "s3", date: "2026-11-12", time: "09:00" }),
        "2026-11-12T10:00:00Z",
      ),
    ];
    const tree = buildProjectTree({ entries, notes, now: SESSION_NOW });
    expect(tree.machines).toHaveLength(1);
    const machine = tree.machines[0];
    expect(machine.count).toEqual(3);
    expect(machine.folders).toHaveLength(1);
    expect(machine.folders[0].path).toEqual("/home/joseti/projects/syncwin");
    expect(machine.folders[0].label).toEqual("projects/syncwin");
    expect(machine.folders[0].count).toEqual(2);
    expect(machine.folders[0].sessions.map((node) => node.session.session)).toEqual(["s2", "s1"]);
    expect(machine.sessions).toHaveLength(1);
    expect(machine.sessions[0].kind).toEqual("session");
    expect(machine.sessions[0].path).toEqual("/srv/outro");
    expect(machine.sessions[0].noteId).toEqual("b1");
    expect(machine.sessions[0].entryId).toEqual("entry-1");
    expect(tree.sessions.map((node) => node.session.session)).toEqual(["s2", "s3", "s1"]);
  });

  it("ordena as sessoes soltas da mais nova para a mais antiga", () => {
    const notes = [
      noteOf(
        "velha",
        at({ path: "/srv/antigo", session: "s-antigo", date: "2026-11-01", time: "09:00" }),
        "2026-11-01T10:00:00Z",
      ),
      noteOf(
        "nova",
        at({ path: "/srv/novo", session: "s-novo", date: "2026-11-13", time: "09:00" }),
        "2026-11-13T10:00:00Z",
      ),
    ];
    const tree = buildProjectTree({ entries, notes, now: SESSION_NOW });
    expect(tree.machines[0].sessions.map((node) => node.path)).toEqual(["/srv/novo", "/srv/antigo"]);
    expect(tree.sessions.map((node) => node.session.session)).toEqual(["s-novo", "s-antigo"]);
  });

  it("nota v1 fica fora da arvore e continua no indice v1", () => {
    const notes = [
      { id: "v1", content_markdown: fullBlock, updated_at: "2026-11-14T10:00:00Z" },
      noteOf("v2", sessionPayload(), "2026-11-14T10:00:00Z"),
    ];
    const tree = buildProjectTree({ entries, notes, now: SESSION_NOW });
    expect(tree.count).toEqual(1);
    expect(tree.machines).toHaveLength(1);
    expect(tree.machines[0].sessions[0].noteId).toEqual("v2");
    expect(parseProjectLog(fullBlock, "dyarium")).toHaveLength(1);
  });

  it("preserva <, &, aspas e acento em maquina, caminho e titulo", () => {
    const payload = at({
      machine: 'maquina <b> & "x"',
      path: '</tmp/a & b>/ção',
      items: [{ kind: "feat", title: 'tag <i> & "fim"' }],
    });
    const notes = [noteOf("h1", payload, "2026-11-14T10:00:00Z")];
    const tree = buildProjectTree({ entries, notes, now: SESSION_NOW });
    const machine = tree.machines[0];
    expect(machine.machine).toEqual('maquina <b> & "x"');
    expect(machine.sessions[0].path).toEqual('</tmp/a & b>/ção');
    expect(machine.sessions[0].session.items[0].title).toEqual('tag <i> & "fim"');
  });

  it("entrada vazia devolve arvore vazia", () => {
    expect(buildProjectTree({ entries: [], notes: [], now: SESSION_NOW })).toEqual({
      machines: [],
      sessions: [],
      count: 0,
    });
  });
});

describe("daySeries", () => {
  const itemAt = (date: string): LogItem => ({
    kind: "feat",
    title: "t",
    project: "p",
    date,
    time: "09:00",
    sessionId: "s",
  });

  it("preenche os dias vazios e nao estica o intervalo", () => {
    const days = daySeries([
      itemAt("2026-11-01"),
      itemAt("2026-11-01"),
      itemAt("2026-11-08"),
    ]);
    expect(days).toHaveLength(8);
    expect(days[0]).toEqual({ date: "2026-11-01", items: 2 });
    expect(days.slice(1, 7).map((day) => day.items)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(days[7]).toEqual({ date: "2026-11-08", items: 1 });
  });

  it("respeita os limites explicitos do intervalo", () => {
    const days = daySeries([itemAt("2026-11-03")], { from: "2026-11-01", to: "2026-11-05" });
    expect(days.map((day) => day.date)).toEqual([
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
    ]);
    expect(days.map((day) => day.items)).toEqual([0, 0, 1, 0, 0]);
  });

  it("sem item nao inventa serie", () => {
    expect(daySeries([])).toEqual([]);
    expect(daySeries([{ ...itemAt(""), date: "2026-13-40" }])).toEqual([]);
  });
});

describe("folderAggregate", () => {
  const sessionOf = (overrides: Record<string, unknown>) => {
    const session = parseSessionNote(sessionNote(sessionPayload(overrides)), SESSION_NOW);
    if (!session) throw new Error("sessao de teste invalida");
    return session;
  };

  it("soma sessoes, itens, commits, kinds e o intervalo inteiro da pasta", () => {
    const primeira = sessionOf({
      session: "s1",
      date: "2026-11-01",
      time: "08:00",
      opened: "2026-11-01T08:00:00Z",
      state: "closed",
      closed: "2026-11-01T09:00:00Z",
      items: [
        { kind: "feat", title: "a" },
        { kind: "fix", title: "b" },
      ],
      commits: [{ hash: "aaa1111" }],
      links: [],
    });
    const segunda = sessionOf({
      session: "s2",
      date: "2026-11-08",
      time: "08:00",
      opened: "2026-11-08T08:00:00Z",
      items: [{ kind: "feat", title: "c" }],
      commits: [{ hash: "bbb2222" }, { hash: "ccc3333" }],
      links: [],
    });
    const aggregate = folderAggregate([primeira, segunda]);
    expect(aggregate.sessionCount).toEqual(2);
    expect(aggregate.itemCount).toEqual(3);
    expect(aggregate.commitCount).toEqual(3);
    expect(aggregate.kindCounts).toEqual({ feat: 2, fix: 1 });
    expect(aggregate.sessions.map((session) => session.session)).toEqual(["s2", "s1"]);
    expect(aggregate.from).toEqual("2026-11-01");
    expect(aggregate.to).toEqual("2026-11-08");
    expect(aggregate.days).toHaveLength(8);
    expect(aggregate.days[0]).toEqual({ date: "2026-11-01", items: 2 });
    expect(aggregate.days[4]).toEqual({ date: "2026-11-05", items: 0 });
    expect(aggregate.days[7]).toEqual({ date: "2026-11-08", items: 1 });
  });

  it("pasta sem sessao devolve agregado vazio", () => {
    expect(folderAggregate([])).toEqual({
      sessions: [],
      sessionCount: 0,
      itemCount: 0,
      commitCount: 0,
      kindCounts: {},
      days: [],
      from: "",
      to: "",
    });
  });
});
