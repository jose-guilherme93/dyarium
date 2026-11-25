package api

import (
	"net/http"

	"github.com/joseti/dyarium/internal/mcpserver"
)

// handleMCPProjects lists the entries of the MCP notebook with the session facts
// the settings screen reads. The fence format and the derived state live in
// internal/mcpserver; this handler only serializes the result.
func (s *Server) handleMCPProjects(w http.ResponseWriter, r *http.Request) {
	projects, err := mcpserver.Projects(r.Context(), s.deps.Store)
	if err != nil {
		s.writeInternal(w, r, "internal", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": projects})
}
