package api

import "net/http"

func (s *Server) handleListModels(w http.ResponseWriter, _ *http.Request) {
	if s.deps.Models == nil {
		writeJSON(w, http.StatusOK, map[string]any{"models": []any{}})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"models": s.deps.Models.List()})
}

func (s *Server) handleDownloadModel(w http.ResponseWriter, r *http.Request) {
	if s.deps.Models == nil {
		writeError(w, http.StatusServiceUnavailable, "unavailable", "gerenciador de modelos indisponivel")
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(r, &req); err != nil || req.Name == "" {
		writeError(w, http.StatusBadRequest, "invalid_body", "informe o nome do modelo")
		return
	}
	if err := s.deps.Models.StartDownload(req.Name); err != nil {
		writeError(w, http.StatusConflict, "download_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "baixando", "name": req.Name})
}
