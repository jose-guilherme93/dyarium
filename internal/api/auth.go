package api

import (
	"crypto/subtle"
	"net/http"
	"strings"
)

const bearerPrefix = "Bearer "

// requireAuth enforces the static bearer token configured in DIARY_TOKEN. The
// token may also arrive as a query parameter, because the browser EventSource
// API cannot set request headers.
func (s *Server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := ""
		if header := r.Header.Get("Authorization"); strings.HasPrefix(header, bearerPrefix) {
			token = strings.TrimPrefix(header, bearerPrefix)
		} else if q := r.URL.Query().Get("token"); q != "" {
			token = q
		}
		if token == "" {
			writeError(w, http.StatusUnauthorized, "unauthorized", "missing bearer token")
			return
		}
		if subtle.ConstantTimeCompare([]byte(token), []byte(s.deps.Config.Token)) != 1 {
			writeError(w, http.StatusUnauthorized, "unauthorized", "invalid token")
			return
		}
		next.ServeHTTP(w, r)
	})
}
