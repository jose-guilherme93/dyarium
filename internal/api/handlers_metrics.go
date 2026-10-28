package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/joseti/dyarium/internal/store"
)

// MetricsSchemaVersion is the newest snapshot contract the server accepts. Old
// versions stay accepted while there are apps in the field; an unknown future
// version is refused instead of being stored in a shape the dashboard cannot
// read.
const (
	MetricsSchemaVersion    = 2
	minMetricsSchemaVersion = 1
)

// maxMetricsPayloadBytes caps the snapshot document. It is far above what the
// metrics need, but prevents a client from filling the database.
const maxMetricsPayloadBytes = 256 * 1024

// deviceIDPattern accepts the opaque device ids the app generates (letters,
// digits, dash, underscore and dot).
var deviceIDPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)

// handlePutMetrics stores the metrics snapshot of a device. The app computes
// everything offline and sends the finished document, so the dashboard shows
// exactly what the phone shows. The whole document is preserved for both
// schemas; the server only understands the envelope.
func (s *Server) handlePutMetrics(w http.ResponseWriter, r *http.Request) {
	var body map[string]json.RawMessage
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}

	deviceID, ok := metricsString(body, "device_id")
	if !ok || !deviceIDPattern.MatchString(strings.TrimSpace(deviceID)) {
		writeError(w, http.StatusBadRequest, "invalid_device_id", "device_id invalido")
		return
	}
	deviceID = strings.TrimSpace(deviceID)

	deviceName, ok := metricsString(body, "device_name")
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_device_name", "device_name invalido")
		return
	}

	schema, ok := metricsInt(body, "schema")
	if !ok || schema < minMetricsSchemaVersion || schema > MetricsSchemaVersion {
		writeError(w, http.StatusBadRequest, "unsupported_schema", "versao de schema nao suportada")
		return
	}
	if code, message := validateMetricsDocument(body, schema); code != "" {
		writeError(w, http.StatusBadRequest, code, message)
		return
	}

	generatedAt := time.Now().UTC()
	if raw, ok := metricsString(body, "generated_at"); !ok {
		writeError(w, http.StatusBadRequest, "invalid_generated_at", "generated_at invalido")
		return
	} else if raw = strings.TrimSpace(raw); raw != "" {
		parsed, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_generated_at", "generated_at invalido")
			return
		}
		generatedAt = parsed.UTC()
	}

	// O documento e guardado inteiro; o envelope sai e a versao/data sao
	// normalizadas. Assim o app pode evoluir as secoes sem migracao no servidor.
	delete(body, "device_id")
	delete(body, "device_name")
	body["schema"] = json.RawMessage(strconv.Itoa(schema))
	generatedRaw, err := json.Marshal(generatedAt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	body["generated_at"] = generatedRaw

	payload, err := json.Marshal(body)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if len(payload) > maxMetricsPayloadBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "too_large", "metricas excedem o tamanho maximo")
		return
	}

	received := time.Now().UTC()
	snapshot := store.MetricsSnapshot{
		DeviceID:      deviceID,
		DeviceName:    strings.TrimSpace(deviceName),
		SchemaVersion: schema,
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
		"schema":      schema,
	})
}

// validateMetricsDocument checks the one section each schema requires. The rest
// of the document is stored as-is, so unknown sections are future-proof.
func validateMetricsDocument(body map[string]json.RawMessage, schema int) (string, string) {
	section, code := "writing", "invalid_writing"
	if schema >= 2 {
		section, code = "windows", "invalid_windows"
	}
	raw, ok := body[section]
	if !ok || isJSONNull(raw) || !isJSONObject(raw) {
		return code, "metricas ausentes ou invalidas"
	}
	if schema >= 2 {
		raw, ok := body["streak"]
		if !ok || isJSONNull(raw) || !isJSONObject(raw) {
			return "invalid_streak", "streak invalido"
		}
	}
	if raw, ok := body["history"]; ok && !isJSONNull(raw) && !isJSONObject(raw) {
		return "invalid_history", "historico invalido"
	}
	return "", ""
}

func metricsString(body map[string]json.RawMessage, key string) (string, bool) {
	raw, ok := body[key]
	if !ok || isJSONNull(raw) {
		return "", true
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", false
	}
	return value, true
}

func metricsInt(body map[string]json.RawMessage, key string) (int, bool) {
	raw, ok := body[key]
	if !ok {
		return 0, false
	}
	var value int
	if err := json.Unmarshal(raw, &value); err != nil {
		return 0, false
	}
	return value, true
}

func isJSONNull(raw json.RawMessage) bool {
	return string(bytes.TrimSpace(raw)) == "null"
}

func isJSONObject(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	return len(trimmed) > 0 && trimmed[0] == '{' && json.Valid(trimmed)
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
