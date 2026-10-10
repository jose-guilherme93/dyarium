package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/joseti/dyarium/internal/events"
)

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "no_stream", "streaming indisponivel")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	var lastID int64
	if v := r.Header.Get("Last-Event-ID"); v != "" {
		lastID, _ = strconv.ParseInt(v, 10, 64)
	}
	entryFilter := r.URL.Query().Get("entry_id")

	ch, unsubscribe := s.deps.Events.Subscribe()
	defer unsubscribe()

	writeEvent(w, flusher, s.deps.Events.Since(lastID), entryFilter)

	keepAlive := time.NewTicker(25 * time.Second)
	defer keepAlive.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case ev, ok := <-ch:
			if !ok {
				return
			}
			if !matchesEntry(ev, entryFilter) {
				continue
			}
			writeSingleEvent(w, flusher, ev)
		case <-keepAlive.C:
			fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		}
	}
}

func writeEvent(w http.ResponseWriter, flusher http.Flusher, events []events.Event, entryFilter string) {
	for _, ev := range events {
		if !matchesEntry(ev, entryFilter) {
			continue
		}
		writeSingleEvent(w, flusher, ev)
	}
}

func writeSingleEvent(w http.ResponseWriter, flusher http.Flusher, ev events.Event) {
	fmt.Fprintf(w, "id: %d\nevent: %s\ndata: %s\n\n", ev.ID, ev.Name, ev.Data)
	flusher.Flush()
}

func matchesEntry(ev events.Event, entryFilter string) bool {
	if entryFilter == "" {
		return true
	}
	var payload map[string]any
	if err := json.Unmarshal(ev.Data, &payload); err != nil {
		return true
	}
	id, _ := payload["entry_id"].(string)
	return id == "" || id == entryFilter
}
