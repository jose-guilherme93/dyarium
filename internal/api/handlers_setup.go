package api

import (
	"net/http"
	"strings"

	"github.com/jose-guilherme93/dyarium/internal/bootstrap"
)

// handleSetupState reports whether the first-run setup is still open. It is a
// public route: the dashboard needs it before it has any token.
func (s *Server) handleSetupState(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"required": s.deps.Tokens.SetupPending(),
		"version":  s.deps.Version.Version,
	})
}

// handleSetupClaim stores the operator-chosen token and closes the setup
// window. It only exists while setup is pending.
func (s *Server) handleSetupClaim(w http.ResponseWriter, r *http.Request) {
	if !s.deps.Tokens.SetupPending() {
		writeError(w, http.StatusConflict, "already_configured", "a instancia ja foi configurada")
		return
	}
	var body struct {
		Token string `json:"token"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	token := strings.TrimSpace(body.Token)
	if err := bootstrap.Claim(s.deps.Config.DataDir, token); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_token", err.Error())
		return
	}
	s.deps.Tokens.Claim(token)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
