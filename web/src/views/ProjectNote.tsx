import type { ReactNode } from "react";
import { Button } from "../ui";
import {
  daySeries,
  type DayBucket,
} from "../../../mobile/src/core/projetoLog";
import {
  KindMeter,
  StateMark,
  TypeIcon,
  kindKeys,
  shortDay,
} from "../components/projectui";
import { folderReading, type PjFolderNode, type PjSessionNode } from "../lib/useProjectsIndex";

/**
 * Leitura da nota no painel da superficie Projetos (docs/projetos.md): para a
 * sessao selecionada, o caminho em mono como titulo display, o nome da sessao,
 * a linha de meta, o resumo, a tabela de itens e, no fim, o grafico de colunas
 * por dia de calendario. Para o no de pasta, o agregado: sessoes, itens e
 * commits em numero, composicao por kind, linha de atividade no intervalo real
 * e a lista das sessoes. O fence fica oculto.
 */

const shortDate = shortDay;

function clockOf(iso: string | undefined): string {
  if (!iso) return "";
  const at = iso.indexOf("T");
  return at > 0 ? iso.slice(at + 1, at + 6) : "";
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Faixa de tempo da sessao: aberta ate "em curso". */
function timeRange(session: PjSessionNode["session"]): string {
  const start = `${shortDate(session.date)} ${session.time}`;
  if (session.state === "closed" && session.closed) {
    return `${start} – ${shortDate(session.closed.slice(0, 10))} ${clockOf(session.closed)}`;
  }
  return `${start} – em curso`;
}

/**
 * Colunas por dia de calendario: dia sem item continua slot vazio, sem eixo y,
 * rotulos nas pontas e o valor no hover. Sessao sem fechamento tem a ultima
 * coluna com dados em contorno, nao preenchida.
 */
export function DayColumns({
  days,
  open,
}: {
  days: DayBucket[];
  open: boolean;
}) {
  if (days.length === 0) {
    return (
      <div className="pjx-chart-empty" aria-hidden="true">
        <span />
        <span className="pjx-chart-empty--off" />
        <span />
      </div>
    );
  }
  const W = 640;
  const H = 108;
  const topY = 10;
  const baseY = 84;
  const labY = 100;
  const slot = W / days.length;
  const yMax = Math.max(1, ...days.map((d) => d.items));
  const colW = Math.max(6, Math.min(24, slot * 0.52));
  const plotH = baseY - topY;
  let lastData = -1;
  days.forEach((bucket, index) => {
    if (bucket.items > 0) lastData = index;
  });
  const nodes: ReactNode[] = [];
  days.forEach((bucket, index) => {
    const x = (slot * index + slot / 2 - colW / 2).toFixed(1);
    if (bucket.items > 0) {
      const h = Math.max(3, (bucket.items / yMax) * plotH);
      const hollow = open && index === lastData;
      nodes.push(
        <rect
          key={bucket.date}
          className={hollow ? "pjx-col pjx-col--hollow" : "pjx-col"}
          x={x}
          y={(baseY - h).toFixed(1)}
          width={colW.toFixed(1)}
          height={h.toFixed(1)}
        >
          <title>{`${shortDay(bucket.date)} · ${plural(bucket.items, "item", "itens")}`}</title>
        </rect>,
      );
    } else {
      nodes.push(
        <rect
          key={bucket.date}
          className="pjx-col pjx-col--empty"
          x={x}
          y={topY}
          width={colW.toFixed(1)}
          height={plotH}
        />,
      );
    }
  });
  const n = days.length;
  return (
    <svg className="pjx-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="itens por dia">
      <line className="pjx-base" x1="0" x2={W} y1={baseY + 0.5} y2={baseY + 0.5} />
      {nodes}
      {n === 1 ? (
        <text className="dy-mono" x={W / 2} y={labY} textAnchor="middle">
          {shortDay(days[0].date)}
        </text>
      ) : (
        <>
          <text className="dy-mono" x="2" y={labY} textAnchor="start">
            {shortDay(days[0].date)}
          </text>
          <text className="dy-mono" x={W - 2} y={labY} textAnchor="end">
            {shortDay(days[n - 1].date)}
          </text>
          {n >= 8 ? (
            <text className="dy-mono" x={(slot * Math.floor((n - 1) / 2) + slot / 2).toFixed(1)} y={labY} textAnchor="middle">
              {shortDay(days[Math.floor((n - 1) / 2)].date)}
            </text>
          ) : null}
        </>
      )}
    </svg>
  );
}

/** Linha de atividade no intervalo real da pasta: dia vazio desce a base. */
export function ActivityLine({ days }: { days: DayBucket[] }) {
  if (days.length === 0) {
    return (
      <div className="pjx-chart-empty" aria-hidden="true">
        <span />
        <span className="pjx-chart-empty--off" />
        <span />
      </div>
    );
  }
  const W = 640;
  const H = 108;
  const padL = 14;
  const padR = 14;
  const padT = 10;
  const padB = 24;
  const iw = W - padL - padR;
  const ih = H - padT - padB;
  const yMax = Math.max(1, ...days.map((d) => d.items));
  const span = Math.max(1, days.length - 1);
  const x = (index: number) => padL + (index / span) * iw;
  const y = (value: number) => padT + ih - (value / yMax) * ih;
  const points = days.map((bucket, index) => `${x(index).toFixed(1)},${y(bucket.items).toFixed(1)}`);
  return (
    <svg className="pjx-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="atividade por dia">
      <line className="pjx-base" x1="0" x2={W} y1={y(0) + 0.5} y2={y(0) + 0.5} />
      <polyline className="pjx-line" points={points.join(" ")} />
      {days.map((bucket, index) =>
        bucket.items > 0 ? (
          <circle key={bucket.date} className="pjx-pt" cx={x(index)} cy={y(bucket.items)} r="3">
            <title>{`${shortDay(bucket.date)} · ${plural(bucket.items, "item", "itens")}`}</title>
          </circle>
        ) : null,
      )}
      <text className="dy-mono" x={x(0)} y={H - 8} textAnchor="start">
        {shortDay(days[0].date)}
      </text>
      <text className="dy-mono" x={x(days.length - 1)} y={H - 8} textAnchor="end">
        {shortDay(days[days.length - 1].date)}
      </text>
    </svg>
  );
}

/** Leitura da nota de uma sessao: caminho, nome, meta, resumo, itens e grafico. */
export function SessionPane({
  sessionNode,
  onEdit,
}: {
  sessionNode: PjSessionNode;
  onEdit: (entryId: string) => void;
}) {
  const session = sessionNode.session;
  const items = session.items;
  const commits = session.commits.length;
  const days = daySeries(items);
  const open = session.state !== "closed";
  return (
    <div className="pjx-pane" data-testid="session-pane">
      <h1 className="pjx-npath dy-display">{session.path}</h1>
      <div className="pjx-nname dy-title">
        <TypeIcon kind="session" small /> {sessionNode.title}
      </div>
      <p className="pjx-nmeta dy-mono">
        <span>{session.machine}</span>
        <span aria-hidden="true">·</span>
        <span>{timeRange(session)}</span>
        <span aria-hidden="true">·</span>
        <span>{plural(items.length, "item", "itens")}</span>
        {commits > 0 ? (
          <>
            <span aria-hidden="true">·</span>
            <span>
              {commits} {commits === 1 ? "commit" : "commits"}
            </span>
          </>
        ) : null}
      </p>
      {session.summary ? <p className="pjx-nlede dy-body">{session.summary}</p> : null}

      {items.length > 0 ? (
        <>
          <div className="pjx-clab dy-label">itens</div>
          <table className="pjx-ntbl">
            <thead>
              <tr>
                <th className="dy-label">kind</th>
                <th className="dy-label">item</th>
                <th className="dy-label pjx-right">commit</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, at) => (
                <tr key={`${item.title}:${at}`} title={item.title}>
                  <td className="pjx-kcell dy-mono">{item.kind}</td>
                  <td className="pjx-ncell">{item.title}</td>
                  <td className="pjx-right">
                    {item.commit ? (
                      item.url ? (
                        <a className="pjx-cc dy-mono" href={item.url} target="_blank" rel="noreferrer">
                          {item.commit}
                        </a>
                      ) : (
                        <span className="pjx-cc pjx-cc--plain dy-mono">{item.commit}</span>
                      )
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <div className="pjx-slotshape" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}

      {items.length > 0 ? (
        <>
          <div className="pjx-clab dy-label">itens por dia</div>
          <DayColumns days={days} open={open} />
        </>
      ) : null}

      {sessionNode.entryId ? (
        <div className="pjx-pane-foot">
          <Button variant="ghost" size="sm" onClick={() => onEdit(sessionNode.entryId as string)}>
            <span className="pjx-ico pjx-ico--sm" aria-hidden="true">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11.3 2.4 13.6 4.7 5.4 12.9l-3.2.9.9-3.2z" />
              </svg>
            </span>
            Editar
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Leitura do no de pasta: numeros, composicao, atividade e sessoes. */
export function FolderPane({
  folder,
  onOpenSession,
}: {
  folder: PjFolderNode;
  onOpenSession: (id: string) => void;
}) {
  const agg = folderReading(folder);
  const counts = agg.kindCounts;
  const keys = kindKeys(counts);
  return (
    <div className="pjx-pane" data-testid="folder-pane">
      <h1 className="pjx-npath dy-display">{folder.path}</h1>
      <p className="pjx-nmeta dy-mono">
        <span>{folder.machine}</span>
        {agg.from && agg.to ? (
          <>
            <span aria-hidden="true">·</span>
            <span>
              {shortDate(agg.from)} – {shortDate(agg.to)}
            </span>
          </>
        ) : null}
      </p>

      <div className="pjx-stats">
        <span className="pjx-stat">
          <b className="dy-display">{agg.sessionCount}</b>
          <span className="dy-label">sessões</span>
        </span>
        <span className="pjx-stat">
          <b className="dy-display">{agg.itemCount}</b>
          <span className="dy-label">itens</span>
        </span>
        <span className="pjx-stat">
          <b className="dy-display">{agg.commitCount}</b>
          <span className="dy-label">commits</span>
        </span>
      </div>

      {agg.itemCount > 0 ? (
        <>
          <div className="pjx-fbar">
            <span className="pjx-flegend">
              {keys.map((kind, index) => (
                <span key={kind} className="dy-mono">
                  {index > 0 ? <span aria-hidden="true" className="pjx-sepd"> · </span> : null}
                  {counts[kind]} {kind}
                </span>
              ))}
            </span>
            <KindMeter counts={counts} total={agg.itemCount} widthClass="pjx-mbar--wide" />
          </div>
          <div className="pjx-clab dy-label">itens por dia</div>
          <ActivityLine days={agg.days} />
        </>
      ) : (
        <div className="pjx-slotshape" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}

      <div className="pjx-clab dy-label">sessões</div>
      <ul className="pjx-slist">
        {agg.sessions.map((session) => {
          const node = folder.sessions.find((one) => one.session.id === session.id);
          return (
            <li key={session.id}>
              <button
                type="button"
                className="pjx-srow"
                title={node?.title ?? session.session}
                onClick={() => onOpenSession(session.id)}
              >
                <span className="pjx-sname">{node?.title ?? session.session}</span>
                <span className="pjx-smeta">
                  <span className="dy-mono">
                    {shortDate(session.date)} {session.time}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="dy-mono">
                    {plural(session.items.length, "item", "itens")}
                  </span>
                </span>
                <StateMark state={session.state} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
