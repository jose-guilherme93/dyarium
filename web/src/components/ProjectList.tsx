import { useState } from "react";
import { ListSkeleton } from "./Skeleton";
import { Chevron, Guides, KindMeter, StateMark, TypeIcon, shortDay } from "./projectui";
import { itemKindCounts, pathLabel } from "../../../mobile/src/core/projetoLog";
import type {
  PjFolderNode,
  PjMachineNode,
  PjSessionNode,
  ProjectsIndex,
  ProjectsNode,
} from "../lib/useProjectsIndex";

/**
 * Arvore de projetos do caderno MCP, na sidebar (docs/projetos.md): no de
 * maquina, no de pasta so quando o caminho tem 2+ sessoes, e sessao de caminho
 * unico como linha solta com o caminho na segunda linha. O mesmo caminho em
 * maquinas diferentes sao dois nos. Projetos v1 (sem diretorio) seguem listados
 * como antes, abaixo da arvore. O no escolhido vive no App; o recolhido e local.
 */

interface ProjectListProps {
  index: ProjectsIndex | null;
  /** No escolhido; dirige o escopo da superficie. */
  node: ProjectsNode;
  onSelect: (node: ProjectsNode) => void;
  /** Icones escolhidos nesta sessao (a escolha local vence a entry). */
  icons: Record<string, string>;
  loading: boolean;
  error: string;
}

/** Quadrado da letra quando o projeto ainda nem tem icone. */
export function ProjectMark({ icon, project }: { icon: string; project: string }) {
  return (
    <span className="pjx-mark" aria-hidden="true">
      {icon || (project.charAt(0) || "?")}
    </span>
  );
}

function dayNumber(date: string): number {
  const parts = date.split("-").map(Number);
  if (parts.length < 3 || parts.some((part) => Number.isNaN(part))) return Number.NaN;
  return Date.UTC(parts[0], parts[1] - 1, parts[2]) / 864e5;
}

function todayNumber(): number {
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 864e5;
}

/** Recencia do ultimo trabalho do projeto: hoje, ontem ou a N dias. */
function relativeDay(date: string | null): string {
  if (!date) return "sem trabalho";
  const day = dayNumber(date);
  if (Number.isNaN(day)) return date;
  const diff = todayNumber() - day;
  if (diff <= 0) return "hoje";
  if (diff === 1) return "ontem";
  return `há ${diff} dias`;
}

/** Ordena fills e sessoes soltas de uma maquina por atividade (nova primeiro). */
function machineChildren(machine: PjMachineNode): Array<
  | { type: "folder"; folder: PjFolderNode }
  | { type: "session"; session: PjSessionNode }
> {
  type Child = { type: "folder"; folder: PjFolderNode } | { type: "session"; session: PjSessionNode };
  const children: Child[] = [
    ...machine.folders.map((folder) => ({ type: "folder" as const, folder })),
    ...machine.sessions.map((session) => ({ type: "session" as const, session })),
  ];
  const rank = (child: Child): string =>
    child.type === "folder" ? child.folder.lastActivity : child.session.activity;
  return children.sort((a, b) => (rank(a) < rank(b) ? 1 : rank(a) > rank(b) ? -1 : 0));
}

function SessionLine({
  session,
  flat,
  ancestors,
  elbow,
  selected,
  onSelect,
}: {
  session: PjSessionNode;
  /** Linha solta: o caminho vai na segunda linha. */
  flat: boolean;
  ancestors: boolean[];
  elbow?: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const counts = itemKindCounts(session.session.items);
  const total = session.session.items.length;
  return (
    <li role="none" key={session.session.id}>
      <button
        type="button"
        role="treeitem"
        aria-selected={selected}
        aria-label={flat ? `${session.title} — ${session.path}` : undefined}
        className={`pjx-row pjx-row--sess${selected ? " pjx-row--sel" : ""}${flat ? " pjx-row--flat" : ""}`}
        title={flat ? session.path : session.title}
        onClick={onSelect}
      >
        <Guides ancestors={ancestors} elbow={elbow} />
        <TypeIcon kind="session" />
        <span className="pjx-tmain">
          <span className="pjx-l1">
            <span className="pjx-name">{session.title}</span>
          </span>
          <span className="pjx-l2">
            {flat ? (
              <>
                {/* O ultimo par de segmentos identifica; o caminho inteiro
                    fica no title e no rotulo acessivel da linha. */}
                <span className="dy-mono pjx-ell pjx-path">{pathLabel(session.path)}</span>
                <span className="pjx-segd pjx-segd--time" aria-hidden="true">
                  ·
                </span>
              </>
            ) : null}
            <span className={`dy-mono${flat ? " pjx-time" : ""}`}>
              {flat
                ? `${shortDay(session.session.date)} ${session.session.time}`
                : session.session.time}
            </span>
            <span className="pjx-segd" aria-hidden="true">
              ·
            </span>
            <span className="dy-mono">
              {total} {total === 1 ? "item" : "itens"}
            </span>
          </span>
        </span>
        <KindMeter counts={counts} total={total} />
        <StateMark state={session.session.state} />
      </button>
    </li>
  );
}

function FolderLine({
  folder,
  ancestors,
  elbow,
  node,
  onSelect,
}: {
  folder: PjFolderNode;
  ancestors: boolean[];
  elbow?: boolean;
  node: ProjectsNode;
  onSelect: (node: ProjectsNode) => void;
}) {
  const [open, setOpen] = useState(true);
  const selected =
    node.kind === "folder" && node.machine === folder.machine && node.path === folder.path;
  return (
    <li role="none">
      <button
        type="button"
        role="treeitem"
        aria-expanded={open}
        aria-selected={selected}
        className={`pjx-row pjx-row--folder${selected ? " pjx-row--sel" : ""}`}
        title={folder.path}
        onClick={() => {
          setOpen((current) => !current);
          onSelect({ kind: "folder", machine: folder.machine, path: folder.path });
        }}
      >
        <Guides ancestors={ancestors} elbow={elbow} />
        <TypeIcon kind="folder" />
        <Chevron open={open} />
        <span className="dy-mono pjx-ell pjx-flabel">{folder.label}</span>
        <span className="pjx-num">{folder.count}</span>
      </button>
      {open ? (
        <ul role="group" className="pjx-group">
          {folder.sessions.map((session, index) => (
            <SessionLine
              key={session.session.id}
              session={session}
              flat={false}
              ancestors={[...ancestors, elbow === true]}
              elbow={index < folder.sessions.length - 1}
              selected={node.kind === "session" && node.id === session.session.id}
              onSelect={() => onSelect({ kind: "session", id: session.session.id })}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function ProjectList({
  index,
  node,
  onSelect,
  icons,
  loading,
  error,
}: ProjectListProps) {
  const [closedMachines, setClosedMachines] = useState<Set<string>>(new Set());
  // O grupo "sem pasta" recolhe sozinho quando carrega mais de um projeto;
  // com um so projeto ele ja vem aberto (mesma regra do app).
  const [collapsedV1, setCollapsedV1] = useState<boolean | null>(null);
  const tree = index?.tree ?? { machines: [], sessions: [], count: 0 };
  const v1Projects = index?.v1Projects ?? [];
  const totalItems = index?.rows.length ?? 0;
  const v1Open = collapsedV1 ?? v1Projects.length <= 1;

  if (error) {
    return (
      <div className="list pjx-list dy-body">
        <p className="error list-error">{error}</p>
      </div>
    );
  }

  if (loading && !index) {
    return (
      <div className="list pjx-list dy-body">
        <div className="list-scroll">
          <ListSkeleton rows={7} />
        </div>
      </div>
    );
  }

  const emptyNotebook = tree.count === 0 && v1Projects.length === 0;

  const toggleMachine = (machine: string) =>
    setClosedMachines((current) => {
      const next = new Set(current);
      if (next.has(machine)) {
        next.delete(machine);
      } else {
        next.add(machine);
      }
      return next;
    });

  return (
    <div className="list pjx-list dy-body">
      <div className="list-scroll">
        {emptyNotebook ? (
          <div className="pjx-empty" role="status">
            <TypeIcon kind="session" />
            <span className="dy-label">sem sessões</span>
          </div>
        ) : null}
        <ul role="tree" aria-label="Projetos" className="pjx-tree">
          <li role="none">
            <button
              type="button"
              role="treeitem"
              aria-selected={node.kind === "all"}
              className={`pjx-row pjx-row--all${node.kind === "all" ? " pjx-row--sel" : ""}`}
              onClick={() => onSelect({ kind: "all" })}
            >
              <span className="pjx-name">Todos</span>
              <span className="pjx-num">{totalItems}</span>
            </button>
          </li>
          {v1Projects.length > 0 ? (
            <li role="none">
              <button
                type="button"
                role="treeitem"
                aria-expanded={v1Open}
                aria-label={`sem pasta, ${v1Projects.length} ${v1Projects.length === 1 ? "projeto" : "projetos"}`}
                className="pjx-row pjx-row--ghead"
                onClick={() => setCollapsedV1(!v1Open)}
              >
                <Chevron open={v1Open} />
                <span className="dy-label pjx-glabel">sem pasta</span>
                <span className="pjx-num">{v1Projects.length}</span>
              </button>
              {v1Open ? (
                <ul role="group" className="pjx-group">
                  {v1Projects.map((agg) => {
                    const items = agg.sessions.reduce(
                      (sum, row) => sum + row.session.items.length,
                      0,
                    );
                    const last = agg.sessions[0]?.session.date ?? null;
                    const selected = node.kind === "project" && node.entryId === agg.entryId;
                    return (
                      <li role="none" key={agg.entryId}>
                        <button
                          type="button"
                          role="treeitem"
                          aria-selected={selected}
                          className={`pjx-row pjx-row--v1${selected ? " pjx-row--sel" : ""}`}
                          title={agg.project}
                          onClick={() => onSelect({ kind: "project", entryId: agg.entryId })}
                        >
                          {/* O recuo e o mesmo dos filhos de maquina; sem
                              guia: o grupo nao e arvore de caminho. */}
                          <span className="pjx-tcol" aria-hidden="true">
                            <span className="pjx-tcell" />
                          </span>
                          <ProjectMark icon={icons[agg.entryId] || agg.icon || ""} project={agg.project} />
                          <span className="pjx-tmain">
                            <span className="pjx-l1">
                              <span className="pjx-name">{agg.project}</span>
                            </span>
                            <span className="pjx-l2">
                              <span className="dy-mono">{relativeDay(last)}</span>
                              <span className="pjx-segd" aria-hidden="true">
                                ·
                              </span>
                              <span className="dy-mono">
                                {items} {items === 1 ? "item" : "itens"}
                              </span>
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          ) : null}
          {tree.machines.map((machine) => {
            const open = !closedMachines.has(machine.machine);
            const children = machineChildren(machine);
            const machineSelected = node.kind === "machine" && node.machine === machine.machine;
            return (
              <li role="none" key={machine.machine}>
                <button
                  type="button"
                  role="treeitem"
                  aria-expanded={open}
                  aria-selected={machineSelected}
                  className={`pjx-row pjx-row--machine${machineSelected ? " pjx-row--sel" : ""}`}
                  title={machine.machine}
                  onClick={() => {
                    toggleMachine(machine.machine);
                    onSelect({ kind: "machine", machine: machine.machine });
                  }}
                >
                  <TypeIcon kind="machine" />
                  <Chevron open={open} />
                  <span className="pjx-ell">{machine.machine}</span>
                  <span className="pjx-num">{machine.count}</span>
                </button>
                {open ? (
                  <ul role="group" className="pjx-group">
                    {children.map((child, childIndex) => {
                      const hasNext = childIndex < children.length - 1;
                      if (child.type === "folder") {
                        return (
                          <FolderLine
                            key={`${child.folder.machine}|${child.folder.path}`}
                            folder={child.folder}
                            ancestors={[]}
                            elbow={hasNext}
                            node={node}
                            onSelect={onSelect}
                          />
                        );
                      }
                      return (
                        <SessionLine
                          key={child.session.session.id}
                          session={child.session}
                          flat
                          ancestors={[]}
                          elbow={hasNext}
                          selected={node.kind === "session" && node.id === child.session.session.id}
                          onSelect={() => onSelect({ kind: "session", id: child.session.session.id })}
                        />
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export default ProjectList;
