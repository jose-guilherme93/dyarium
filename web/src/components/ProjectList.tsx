import { ListSkeleton } from "./Skeleton";
import type { ProjectAgg } from "../lib/useProjectsIndex";

/**
 * Lista de projetos do caderno MCP, no lugar onde a NoteList mora nas listas
 * comuns, com o mesmo peso visual (mesmas classes .list / .note-row). Cada
 * projeto tem o seu lugar aqui; abrir um escopa a area principal. No topo,
 * "Todos" devolve a vista completa. Estado (qual projeto esta aberto) vive no
 * App; esta componente so desenha e avisa o clique.
 */

interface ProjectListProps {
  projects: ProjectAgg[];
  /** Total de itens no caderno (a contagem da entrada "Todos"). */
  totalCount: number;
  /** Nome do projeto escolhido; null = "Todos" ativa. */
  selectedProject: string | null;
  onSelect: (project: string | null) => void;
  /** Icones escolhidos nesta sessao (a escolha local vence a entry). */
  icons: Record<string, string>;
  loading: boolean;
  error: string;
}

/** Quadrado da letra quando o projeto ainda nem tem icone. */
export function ProjectMark({ icon, project }: { icon: string; project: string }) {
  return (
    <span className="pj-mark" aria-hidden="true">
      {icon || (project.charAt(0) || "?")}
    </span>
  );
}

function itemsOf(agg: ProjectAgg): number {
  return agg.sessions.reduce((sum, row) => sum + row.session.items.length, 0);
}

export function ProjectList({
  projects,
  totalCount,
  selectedProject,
  onSelect,
  icons,
  loading,
  error,
}: ProjectListProps) {
  /** A escolha local desta sessao vence o icone persistido na entry. */
  const iconFor = (agg: ProjectAgg): string => icons[agg.entryId] || agg.icon || "";

  const rowClass = (active: boolean) => `note-row${active ? " note-row--active" : ""}`;

  return (
    <div className="list pj-list">
      {error ? <p className="error list-error">{error}</p> : null}
      <div className="list-scroll">
        {loading && projects.length === 0 ? (
          <ListSkeleton rows={7} />
        ) : projects.length === 0 ? (
          <div className="empty-state">
            <p>Nenhum projeto ainda.</p>
          </div>
        ) : (
          <ul className="tree stagger-in">
            <li>
              <div className={rowClass(selectedProject === null)}>
                <button
                  type="button"
                  className="note-row-open"
                  aria-pressed={selectedProject === null}
                  onClick={() => onSelect(null)}
                >
                  <span className="note-row-head">
                    <span className="note-row-title">Todos</span>
                    <span className="note-row-date">{totalCount}</span>
                  </span>
                </button>
              </div>
            </li>
            {projects.map((agg) => (
              <li key={agg.entryId}>
                <div className={rowClass(selectedProject === agg.project)}>
                  <button
                    type="button"
                    className="note-row-open"
                    aria-pressed={selectedProject === agg.project}
                    onClick={() => onSelect(agg.project)}
                  >
                    <span className="note-row-head">
                      <ProjectMark icon={iconFor(agg)} project={agg.project} />
                      <span className="note-row-title">{agg.project}</span>
                      <span className="note-row-date">{itemsOf(agg)}</span>
                    </span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default ProjectList;
