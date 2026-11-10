import {
  groupBySession,
  itemKindCounts,
  parseProjectLog,
  parseProjectLogs,
  stripLogFences,
  type LogSession,
} from '../projetoLog';

const fenceOpen = "```dyarium-json";
const fenceClose = "```";
const fence = (payload: string) => [fenceOpen, payload, fenceClose].join("\n");

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
