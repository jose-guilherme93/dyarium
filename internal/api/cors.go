package api

import (
	"net/http"
	"strings"
)

// withCORS deixa um navegador de outra origem ler esta API — o caso do
// dashboard hospedado importando o acervo de uma instancia self-hosted.
//
// Fechado por padrao: sem DIARY_CORS_ORIGINS nenhum cabecalho e enviado e o
// comportamento antigo (mesma origem) continua identico. A lista e de origens
// exatas; nao existe curinga, para nao abrir a API a qualquer site.
func (s *Server) withCORS(next http.Handler) http.Handler {
	allowed := make(map[string]bool, len(s.deps.Config.CORSOrigins))
	for _, origin := range s.deps.Config.CORSOrigins {
		allowed[origin] = true
	}
	if len(allowed) == 0 {
		return next
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && allowed[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Add("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set(
				"Access-Control-Allow-Headers",
				strings.Join([]string{
					"Authorization",
					"Content-Type",
					"X-Content-Sha256",
					"X-Attachment-Id",
					"X-HLC",
					"X-Origin-Instance",
					"X-Origin-Kind",
				}, ", "),
			)
			w.Header().Set("Access-Control-Max-Age", "600")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
