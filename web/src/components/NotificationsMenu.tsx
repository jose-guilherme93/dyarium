import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { formatShortDate } from "../lib/format";
import { useEscape } from "../lib/useEscape";
import type { Activity } from "../types";
import { BellIcon, MicIcon, SparkIcon } from "./icons";

const SEEN_KEY = "dyarium.notifications.seenAt";

/** Quando o menu foi lido pela ultima vez; `null` na primeira visita. */
function readSeenAt(): number | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) {
      return null;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function writeSeenAt(value: number): void {
  try {
    localStorage.setItem(SEEN_KEY, String(value));
  } catch {
    // sem localStorage: a marca vale so para esta sessao
  }
}

/** Tempo curto desde o fim do processo ("agora", "3 min", "2 h", "ontem"). */
function timeAgo(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) {
    return "agora";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} h`;
  }
  if (hours < 48) {
    return "ontem";
  }
  return formatShortDate(value);
}

interface NotificationsMenuProps {
  /** Muda a cada evento de processamento: recarrega a lista. */
  refreshKey: number;
  onOpen: (entryId: string) => void;
}

/**
 * Sino de processos concluidos no dashboard. A lista vem do servidor (nao de
 * um estado efemero do navegador), entao uma transcricao terminada com a aba
 * fechada continua aqui ao abrir de novo. Cada item abre a nota.
 */
export function NotificationsMenu({ refreshKey, onOpen }: NotificationsMenuProps) {
  const [open, setOpen] = useState(false);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [seenAt, setSeenAt] = useState<number | null>(() => readSeenAt());
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    api
      .listActivities()
      .then((result) => {
        if (!active) return;
        const list = result.activities ?? [];
        setActivities(list);
        setLoaded(true);
        // Primeira visita: tudo o que ja tinha terminado nasce lido; o selo
        // passa a contar so o que terminar daqui para a frente.
        if (readSeenAt() === null) {
          const newest = list.reduce(
            (max, activity) => Math.max(max, Date.parse(activity.finished_at) || 0),
            0,
          );
          const baseline = newest || Date.now();
          writeSeenAt(baseline);
          setSeenAt(baseline);
        }
      })
      .catch(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  const markSeen = useCallback(() => {
    // Usa o horario do servidor (o mesmo de `finished_at`), nao o relogio do
    // navegador: assim um desvio de alguns minutos entre os dois nao inventa
    // nem esconde notificacao.
    const newest = activities.reduce(
      (max, activity) => Math.max(max, Date.parse(activity.finished_at) || 0),
      0,
    );
    const value = newest || Date.now();
    writeSeenAt(value);
    setSeenAt(value);
  }, [activities]);

  const close = useCallback(() => {
    setOpen(false);
    markSeen();
  }, [markSeen]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) {
        close();
      }
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open, close]);

  useEscape(open, close);

  const unread =
    seenAt === null
      ? 0
      : activities.filter((activity) => (Date.parse(activity.finished_at) || 0) > seenAt).length;

  // A aba avisa que um processo terminou, sem depender de permissao de
  // notificacao do navegador. O numero e o mesmo do sino e some quando a
  // lista e lida.
  const baseTitle = useRef(
    typeof document === "undefined" ? "dyarium" : document.title || "dyarium",
  );
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = unread > 0 ? `(${unread > 9 ? "9+" : unread}) ${baseTitle.current}` : baseTitle.current;
  }, [unread]);

  const openActivity = (activity: Activity) => {
    close();
    onOpen(activity.entry_id);
  };

  return (
    <div className="notifications-root" ref={root}>
      <div className="notifications-menu">
        <button
          type="button"
          className={unread > 0 ? "icon-button icon-button--active" : "icon-button"}
          onClick={() => (open ? close() : setOpen(true))}
          aria-expanded={open}
          aria-label={
            unread > 0
              ? `Notificações, ${unread} não ${unread === 1 ? "lida" : "lidas"}`
              : "Notificações"
          }
          title="Processos concluídos"
        >
          <BellIcon size={16} />
          {unread > 0 && (
            <span className="notifications-badge" aria-hidden>
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </div>

      {open && (
        <div className="notifications-popover" role="dialog" aria-label="Processos concluídos">
          <div className="notifications-head">
            <span>Concluídos</span>
            {activities.length > 0 && <span className="muted">{activities.length}</span>}
          </div>
          {!loaded ? (
            <p className="notifications-empty">Carregando...</p>
          ) : activities.length === 0 ? (
            <p className="notifications-empty">Nenhum processo concluído.</p>
          ) : (
            <ul className="notifications-list">
              {activities.map((activity) => {
                const isUnread =
                  seenAt !== null && (Date.parse(activity.finished_at) || 0) > seenAt;
                const isTranscription = activity.kind === "transcription";
                const ago = timeAgo(activity.finished_at);
                return (
                  <li key={activity.id}>
                    <button
                      type="button"
                      className={
                        isUnread ? "notification notification--unread" : "notification"
                      }
                      onClick={() => openActivity(activity)}
                      title={activity.title}
                    >
                      <span className="notification-icon" aria-hidden>
                        {isTranscription ? <MicIcon size={14} /> : <SparkIcon size={14} />}
                      </span>
                      <span className="notification-body">
                        <span className="notification-title">{activity.title}</span>
                        <span className="notification-meta">
                          {isTranscription ? "Transcrição" : "Análise"}
                          {ago ? ` · ${ago}` : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
