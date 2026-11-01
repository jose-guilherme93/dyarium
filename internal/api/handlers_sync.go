package api

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"

	"github.com/joseti/dyarium/internal/store"
)

// handleSyncManifest is the compact contract surface used by a peer to decide
// what it is missing. It is intentionally separate from the dashboard list: the
// list carries display previews and changes for UI reasons, while the manifest
// is stable and additive.
//
//	GET /api/v1/sync/manifest?kind=entries&cursor=0&limit=500
//	GET /api/v1/sync/manifest?kind=deleted&cursor=0&limit=500
//	GET /api/v1/sync/manifest?kind=notebooks
func (s *Server) handleSyncManifest(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	kind := strings.TrimSpace(query.Get("kind"))
	if kind == "" {
		kind = "entries"
	}
	limit := parseManifestInt(query.Get("limit"), 500, 5000)
	cursor := parseManifestInt(query.Get("cursor"), 0, 0)

	body := map[string]any{
		"contract":    SyncContract,
		"instance_id": s.deps.Version.InstanceID,
		"kind":        kind,
	}

	switch kind {
	case "entries":
		entries, err := s.deps.Store.ListEntriesFilteredNotebook(r.Context(), limit, cursor, "", "", "", nil, "")
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		ids := make([]string, 0, len(entries))
		for _, e := range entries {
			ids = append(ids, e.ID)
		}
		tags, err := s.deps.Store.ListEntryTagNames(r.Context(), ids)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		attachments, err := s.deps.Store.ListAttachmentIDsForEntries(r.Context(), ids)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		items := make([]map[string]any, 0, len(entries))
		for _, e := range entries {
			items = append(items, manifestEntry(e, tags[e.ID], attachments[e.ID]))
		}
		body["items"] = items
		body["complete"] = len(items) < limit
		if len(items) == limit {
			body["next_cursor"] = strconv.Itoa(cursor + len(items))
		}

	case "deleted":
		entries, err := s.deps.Store.ListDeletedEntries(r.Context(), limit, cursor)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		items := make([]map[string]any, 0, len(entries))
		for _, e := range entries {
			item := map[string]any{
				"id":         e.ID,
				"kind":       store.TombstoneEntry,
				"created_at": e.CreatedAt,
				"updated_at": e.UpdatedAt,
				"purged":     e.Status == store.EntryPurged,
			}
			if e.DeletedAt != nil {
				item["deleted_at"] = *e.DeletedAt
			}
			items = append(items, item)
		}
		body["items"] = items
		body["complete"] = len(items) < limit
		if len(items) == limit {
			body["next_cursor"] = strconv.Itoa(cursor + len(items))
		}

	case "notebooks":
		notebooks, err := s.deps.Store.ListNotebooks(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		items := make([]map[string]any, 0, len(notebooks))
		for _, n := range notebooks {
			items = append(items, notebookJSON(n))
		}
		deleted, err := s.deps.Store.ListTombstones(r.Context(), store.TombstoneNotebook, 5000, 0)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		tombstones := make([]map[string]any, 0, len(deleted))
		for _, t := range deleted {
			tombstones = append(tombstones, map[string]any{
				"id":         t.ID,
				"kind":       t.Kind,
				"deleted_at": t.DeletedAt,
				"origin":     t.Origin,
			})
		}
		body["items"] = items
		body["deleted"] = tombstones
		body["complete"] = true

	default:
		writeError(w, http.StatusBadRequest, "invalid_kind", "kind deve ser entries, deleted ou notebooks")
		return
	}

	writeJSON(w, http.StatusOK, body)
}

// manifestEntry is the contract view of a live entry. It carries identity,
// ordering, versions and the hashes/ids a peer needs to decide what to fetch. It
// deliberately omits display-only fields.
func manifestEntry(e store.Entry, tags, attachmentIDs []string) map[string]any {
	if attachmentIDs == nil {
		attachmentIDs = []string{}
	}
	var bodyHash string
	if e.Preview != "" {
		sum := sha256.Sum256([]byte(e.Preview))
		bodyHash = hex.EncodeToString(sum[:])
	}
	item := map[string]any{
		"id":                    e.ID,
		"kind":                  store.TombstoneEntry,
		"title":                 e.Title,
		"created_at":            e.CreatedAt,
		"updated_at":            e.UpdatedAt,
		"recorded_at":           e.RecordedAt,
		"content_type":          e.ContentType,
		"source":                e.Source,
		"notebook_id":           e.NotebookID,
		"archived":              e.Archived,
		"author":                e.Author,
		"versions":              entryVersions(e),
		"body_hash":             bodyHash,
		"primary_attachment_id": e.PrimaryAttachmentID,
		"attachment_ids":        attachmentIDs,
		"transcript_at":         e.TranscriptAt,
		"analysis_at":           e.AnalysisAt,
		"origin_instance":       e.OriginInstance,
		"origin_kind":           e.OriginKind,
		"chapter_kind":          e.ChapterKind,
		"chapter_status":        e.ChapterStatus,
		"chapter_goal_words":    e.ChapterGoalWords,
		"chapter_synopsis":      e.ChapterSynopsis,
	}
	if e.ChapterPosition != nil {
		item["chapter_position"] = *e.ChapterPosition
	}
	if len(tags) > 0 {
		item["tags"] = tags
	}
	return item
}

func parseManifestInt(raw string, def, max int) int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return def
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 {
		return def
	}
	if max > 0 && n > max {
		return max
	}
	return n
}
