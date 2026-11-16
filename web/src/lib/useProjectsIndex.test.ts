import { describe, expect, it } from "vitest";
import {
  buildIndex,
  findFolder,
  findSessionNode,
  folderReading,
  scopeRows,
  type ProjectsNode,
} from "./useProjectsIndex";
import { parseSessionNote } from "../../../mobile/src/core/projetoLog";
import type { Entry, Note } from "../types";

/** Relogio fixo: o estado interrompido depende de `now` e nunca do relogio real. */
const NOW = Date.parse("2026-11-16T12:00:00Z");

const entry = (id: string, title: string) => ({ id, title }) as unknown as Entry;

const note = (
  id: string,
  entryId: string,
  body: string,
  updatedAt: string,
  title = "sessao",
) =>
  ({
    id,
    entry_id: entryId,
    title,
    content_markdown: body,
    updated_at: updatedAt,
  }) as unknown as Note;

interface V2Spec {
  machine: string;
  path: string;
  session: string;
  state: "open" | "closed";
  date: string;
  time: string;
  summary?: string;
  items?: Array<{ kind: string; title: string; commit?: string }>;
}

/** Nota de sessao v2: bloco humano + fence canonico (docs/projetos.md). */
function sessionNote(spec: V2Spec): string {
  const items = spec.items ?? [];
  const fence = JSON.stringify({
    v: 2,
    kind: "session",
    machine: spec.machine,
    path: spec.path,
    session: spec.session,
    state: spec.state,
    opened: `${spec.date}T${spec.time}:00Z`,
    ...(spec.state === "closed" ? { closed: `${spec.date}T17:20:00Z` } : {}),
    date: spec.date,
    time: spec.time,
    summary: spec.summary ?? "",
    items: items.map((item) => ({ kind: item.kind, title: item.title, commit: item.commit })),
    commits: items.filter((item) => item.commit).map((item) => ({ hash: item.commit })),
  });
  return [
    `## ${spec.date} ${spec.time} · ${spec.machine}`,
    spec.summary ?? "",
    ...items.map((item) => `- **${item.kind}** ${item.title}${item.commit ? ` · ${item.commit}` : ""}`),
    "```dyarium-json",
    fence,
    "```",
  ].join("\n");
}

const OPEN_RECENT = "2026-11-16T11:50:00Z";
const OPEN_OLD = "2026-11-15T20:00:00Z"; // mais de 12h antes de NOW

function fixture() {
  const entries = [entry("e-syn", "syncwin"), entry("e-old", "caixa")];
  const noteLists = [
    [
      note(
        "n-a1",
        "e-syn",
        sessionNote({
          machine: "work",
          path: "/home/joseti/projects/syncwin",
          session: "ses_a",
          state: "closed",
          date: "2026-11-14",
          time: "09:12",
          summary: "Painel estatico no roteador.",
          items: [
            { kind: "feat", title: "coletor de metricas", commit: "aaa1111" },
            { kind: "fix", title: "fuso dos rotulos", commit: "bbb2222" },
          ],
        }),
        "2026-11-14T17:20:00Z",
        "painel estatico",
      ),
      note(
        "n-a2",
        "e-syn",
        sessionNote({
          machine: "work",
          path: "/home/joseti/projects/syncwin",
          session: "ses_b",
          state: "open",
          date: "2026-11-16",
          time: "10:00",
          items: [{ kind: "test", title: "casos do coletor" }],
        }),
        OPEN_RECENT,
        "testes do coletor",
      ),
      note(
        "n-b",
        "e-syn",
        sessionNote({
          machine: "work",
          path: "/home/joseti/projects/syncwin/api",
          session: "ses_c",
          state: "open",
          date: "2026-11-15",
          time: "11:20",
          items: [{ kind: "feat", title: "valida payload", commit: "ccc3333" }],
        }),
        OPEN_OLD,
        "valida payload",
      ),
      // O mesmo caminho em outra maquina: dois nos, nunca um.
      note(
        "n-hp",
        "e-syn",
        sessionNote({
          machine: "hp240",
          path: "/home/joseti/projects/syncwin",
          session: "ses_d",
          state: "closed",
          date: "2026-11-13",
          time: "08:00",
          items: [{ kind: "perf", title: "render em software", commit: "ddd4444" }],
        }),
        "2026-11-13T09:00:00Z",
        "render em software",
      ),
    ],
    [
      // Projeto v1 sem diretorio: fence v1 classico.
      note(
        "n-v1",
        "e-old",
        [
          "## 2026-11-05 09:00 · notebook",
          "Entrega avulsa.",
          "- **fix** saldo duplicado no csv · 4d5e6f7",
        ].join("\n"),
        "2026-11-05T09:00:00Z",
        "resumo caixa",
      ),
    ],
  ];
  return buildIndex(entries, noteLists, NOW);
}

describe("useProjectsIndex: arvore v2", () => {
  it("agrupa por maquina + caminho: pasta com 2+ sessoes, linha solta com 1", () => {
    const index = fixture();
    expect(index.tree.count).toBe(4);
    expect(index.tree.machines.map((m) => m.machine)).toEqual(["hp240", "work"]);

    const work = index.tree.machines.find((m) => m.machine === "work");
    expect(work?.count).toBe(3);
    expect(work?.folders).toHaveLength(1);
    const folder = work?.folders[0];
    expect(folder?.path).toBe("/home/joseti/projects/syncwin");
    expect(folder?.label).toBe("projects/syncwin");
    expect(folder?.count).toBe(2);
    expect(folder?.sessions.map((s) => s.title)).toEqual([
      "testes do coletor",
      "painel estatico",
    ]);
    // Sessao de caminho unico: linha solta com o caminho preservado.
    expect(work?.sessions).toHaveLength(1);
    expect(work?.sessions[0]?.path).toBe("/home/joseti/projects/syncwin/api");
  });

  it("o mesmo caminho em maquinas diferentes sao dois nos", () => {
    const index = fixture();
    const paths = index.tree.machines.flatMap((m) => [
      ...m.folders.map((f) => `${m.machine}|${f.path}`),
      ...m.sessions.map((s) => `${m.machine}|${s.path}`),
    ]);
    expect(paths).toContain("work|/home/joseti/projects/syncwin");
    expect(paths).toContain("hp240|/home/joseti/projects/syncwin");
  });

  it("estado derivado: aberta, interrompida (>12h sem atividade) e fechada", () => {
    const index = fixture();
    const byId = (id: string) => findSessionNode(index.tree, id)?.session.state;
    expect(byId("work|/home/joseti/projects/syncwin|ses_b")).toBe("open");
    expect(byId("work|/home/joseti/projects/syncwin/api|ses_c")).toBe("interrupted");
    expect(byId("work|/home/joseti/projects/syncwin|ses_a")).toBe("closed");
  });

  it("linhas de itens carregam noteId e o escopo por no filtra o certo", () => {
    const index = fixture();
    expect(index.rows.every((row) => row.noteId !== "")).toBe(true);

    const machineNode: ProjectsNode = { kind: "machine", machine: "hp240" };
    expect(scopeRows(index, machineNode).map((row) => row.title)).toEqual([
      "render em software",
    ]);

    const folderNode: ProjectsNode = {
      kind: "folder",
      machine: "work",
      path: "/home/joseti/projects/syncwin",
    };
    const titles = scopeRows(index, folderNode).map((row) => row.title).sort();
    expect(titles).toEqual(["casos do coletor", "coletor de metricas", "fuso dos rotulos"]);

    const sessionNode: ProjectsNode = {
      kind: "session",
      id: "work|/home/joseti/projects/syncwin/api|ses_c",
    };
    expect(scopeRows(index, sessionNode).map((row) => row.title)).toEqual(["valida payload"]);

    expect(scopeRows(index, { kind: "all" })).toHaveLength(index.rows.length);
  });

  it("no de pasta e no de sessao resolvem pela arvore", () => {
    const index = fixture();
    expect(
      findFolder(index.tree, "work", "/home/joseti/projects/syncwin")?.sessions,
    ).toHaveLength(2);
    expect(findFolder(index.tree, "work", "/sem/pasta")).toBeNull();
    expect(findSessionNode(index.tree, "work|/home/joseti/projects/syncwin|ses_z")).toBeNull();
  });

  it("agregado da pasta: sessoes, itens, commits e serie no intervalo real", () => {
    const index = fixture();
    const folder = findFolder(index.tree, "work", "/home/joseti/projects/syncwin");
    expect(folder).not.toBeNull();
    const agg = folderReading(folder!);
    expect(agg.sessionCount).toBe(2);
    expect(agg.itemCount).toBe(3);
    expect(agg.commitCount).toBe(2);
    expect(agg.kindCounts.feat).toBe(1);
    expect(agg.kindCounts.fix).toBe(1);
    expect(agg.kindCounts.test).toBe(1);
    // Do primeiro ao ultimo dia com sessao, dias do meio entram como zero.
    expect(agg.from).toBe("2026-11-14");
    expect(agg.to).toBe("2026-11-16");
    expect(agg.days.map((d) => d.date)).toEqual([
      "2026-11-14",
      "2026-11-15",
      "2026-11-16",
    ]);
    expect(agg.days.map((d) => d.items)).toEqual([2, 0, 1]);
  });

  it("projeto v1 sem diretorio segue no indice de itens e na lista v1", () => {
    const index = fixture();
    const v1 = index.v1Projects.find((agg) => agg.project === "caixa");
    expect(v1).toBeDefined();
    expect(v1?.sessions[0]?.session.items[0]?.title).toBe("saldo duplicado no csv");
    // A entry coberta por sessoes v2 nao sai na lista v1: quem manda e a arvore.
    expect(index.v1Projects.find((agg) => agg.project === "syncwin")).toBeUndefined();
    // A tabela continua vendo o item v1.
    expect(index.rows.map((row) => row.project)).toContain("caixa");
  });
});

describe("useProjectsIndex: parseador compartilhado", () => {
  it("le a nota v2 com updated_at da propria nota", () => {
    const body = sessionNote({
      machine: "work",
      path: "/srv/app",
      session: "ses_x",
      state: "open",
      date: "2026-11-16",
      time: "07:00",
    });
    const parsed = parseSessionNote(
      { id: "n", content_markdown: body, updated_at: OPEN_OLD },
      NOW,
    );
    expect(parsed?.state).toBe("interrupted");
    expect(parsed?.id).toBe("work|/srv/app|ses_x");
  });

  it("nota sem fence v2 (v1 ou livre) nao vira sessao da arvore", () => {
    expect(parseSessionNote({ content_markdown: "livre" }, NOW)).toBeNull();
    const v1 = JSON.stringify({
      v: 1,
      project: "dyarium",
      date: "2026-11-09",
      time: "14:58",
      host: "vps",
      detail: "concise",
    });
    expect(parseSessionNote({ content_markdown: ["```dyarium-json", v1, "```"].join("\n") }, NOW)).toBeNull();
  });
});
