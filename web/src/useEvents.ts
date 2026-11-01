import { useEffect, useRef } from "react";
import type { ServerEvent } from "./types";

const EVENT_NAMES = [
  "entry.status",
  "job.progress",
  "transcript.ready",
  "transcript.revised",
  "analysis.ready",
  "entry.failed",
  "notebook.changed",
];

// useEvents subscribes to the server-sent events stream and invokes the handler
// for each event. It reconnects automatically via EventSource. The token is a
// dependency: entering the token for the first time (or rotating it) has to
// open a new stream, not keep the session without events until a reload.
export function useEvents(token: string, onEvent: (event: ServerEvent) => void): void {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!token || typeof EventSource === "undefined") {
      return;
    }
    const source = new EventSource(`/api/v1/events?token=${encodeURIComponent(token)}`);
    const listener = (event: MessageEvent) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(event.data);
      } catch {
        data = {};
      }
      handlerRef.current({ id: Number(event.lastEventId) || 0, name: event.type, data });
    };
    for (const name of EVENT_NAMES) {
      source.addEventListener(name, listener as EventListener);
    }
    return () => source.close();
  }, [token]);
}
