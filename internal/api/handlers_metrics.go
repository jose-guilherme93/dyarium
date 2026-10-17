package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/joseti/dyarium/internal/store"
)

// MetricsSchemaVersion is the snapshot contract version the server accepts. The
// app sends the version it speaks; a newer one is refused instead of being
// stored in a shape the dashboard cannot read.
const MetricsSchemaVersion = 1

// maxMetricsPayloadBytes caps the snapshot document. It is far above what the
// metrics need, but prevents a client from filling the database.
const maxMetricsPayloadBytes = 256 * 1024

// deviceIDPattern accepts the opaque device ids the app generates (letters,
// digits, dash, underscore and dot).
var deviceIDPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)

type metricsRequest struct {
	DeviceID    string          `json:"device_id"`
	DeviceName  string          `json:"device_name"`
	Schema      int             `json:"schema"`
	GeneratedAt string          `json:"generated_at"`
	Writing     json.RawMessage `json:"writing"`
	History     json.RawMessage `json:"history"`
}

// handlePutMetrics stores the writing-metrics snapshot of a device. The app
// computes everything offline and sends the finished document, so the dashboard
// shows exactly what the phone shows.
func (s *Server) handlePutMetrics(w http.ResponseWriter, r *http.Request) {
	var req metricsRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	deviceID := strings.TrimSpace(req.DeviceID)
	if !deviceIDPattern.MatchString(deviceID) {
		writeError(w, http.StatusBadRequest, "invalid_device_id", "device_id invalido")
		return
	}
	if req.Schema != MetricsSchemaVersion {
		writeError(w, http.StatusBadRequest, "unsupported_schema", "versao de schema nao suportada")
		return
	}
	writing := strings.TrimSpace(string(req.Writing))
	if writing == "" || writing == "null" || !json.Valid([]byte(writing)) {
		writeError(w, http.StatusBadRequest, "invalid_writing", "metricas ausentes ou invalidas")
		return
	}
	if !strings.HasPrefix(writing, "{") {
		writeError(w, http.StatusBadRequest, "invalid_writing", "metricas devem ser um objeto")
		return
	}
	history := strings.TrimSpace(string(req.History))
	if history == "" || history == "null" {
		history = "{}"
	}
	if !json.Valid([]byte(history)) || !strings.HasPrefix(history, "{") {
		writeError(w, http.StatusBadRequest, "invalid_history", "historico invalido")
		return
	}
	if len(writing)+len(history) > maxMetricsPayloadBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "too_large", "metricas excedem o tamanho maximo")
		return
	}
	generatedAt := time.Now().UTC()
	if raw := strings.TrimSpace(req.GeneratedAt); raw != "" {
		if parsed, err := time.Parse(time.RFC3339, raw); err == nil {
			generatedAt = parsed.UTC()
		} else {
			writeError(w, http.StatusBadRequest, "invalid_generated_at", "generated_at invalido")
			return
		}
	}
	// Guarda o documento inteiro (escrita + historico) como o app o montou, para
	// o painel desenhar sem recalcular nada.
	payload, err := json.Marshal(map[string]any{
		"schema":       req.Schema,
		"generated_at": generatedAt,
		"writing":      json.RawMessage(writing),
		"history":      json.RawMessage(history),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	received := time.Now().UTC()
	snapshot := store.MetricsSnapshot{
		DeviceID:      deviceID,
		DeviceName:    strings.TrimSpace(req.DeviceName),
		SchemaVersion: req.Schema,
		GeneratedAt:   generatedAt,
		ReceivedAt:    received,
		Payload:       string(payload),
	}
	if err := s.deps.Store.SaveMetricsSnapshot(r.Context(), snapshot); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":      "ok",
		"received_at": received,
		"schema":      req.Schema,
	})
}

// handleListMetrics returns the last snapshot of each device that ever sent
// metrics, most recently received first.
func (s *Server) handleListMetrics(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			limit = n
		}
	}
	if limit > 200 {
		limit = 200
	}
	snapshots, err := s.deps.Store.ListMetricsSnapshots(r.Context(), limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	out := make([]map[string]any, 0, len(snapshots))
	for _, snapshot := range snapshots {
		item := map[string]any{
			"device_id":    snapshot.DeviceID,
			"device_name":  snapshot.DeviceName,
			"schema":       snapshot.SchemaVersion,
			"generated_at": snapshot.GeneratedAt,
			"received_at":  snapshot.ReceivedAt,
		}
		// Espalha o documento guardado (writing, history) no proprio item.
		var doc map[string]any
		if json.Unmarshal([]byte(snapshot.Payload), &doc) == nil {
			for key, value := range doc {
				item[key] = value
			}
		}
		out = append(out, item)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"snapshots": out,
		"schema":    MetricsSchemaVersion,
	})
}

// handleDeleteMetrics drops the snapshot of one device (aparelho desativado).
func (s *Server) handleDeleteMetrics(w http.ResponseWriter, r *http.Request) {
	deviceID := strings.TrimSpace(r.PathValue("device_id"))
	if err := s.deps.Store.DeleteMetricsSnapshot(r.Context(), deviceID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not_found", "aparelho sem metricas")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
