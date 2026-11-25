package api

import (
	"bytes"
	"log/slog"
	"net/http"
	"strings"
	"testing"
)

// TestInternalErrorHidesStoreDetail garante que o cliente recebe a mensagem
// generica: texto de banco fica so no log do servidor.
func TestInternalErrorHidesStoreDetail(t *testing.T) {
	srv := newTestServer(t)
	var logged bytes.Buffer
	srv.deps.Logger = slog.New(slog.NewTextHandler(&logged, nil))
	if err := srv.deps.Store.Close(); err != nil {
		t.Fatalf("fechar store: %v", err)
	}

	rec, _ := doJSON(t, srv, http.MethodGet, "/api/v1/entries/en_inexistente", nil)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, `"message":"erro interno"`) {
		t.Fatalf("corpo sem mensagem generica: %s", body)
	}
	if strings.Contains(body, "sql:") || strings.Contains(body, "database is closed") {
		t.Fatalf("corpo expoe detalhe do banco: %s", body)
	}

	logText := logged.String()
	if !strings.Contains(logText, "level=ERROR") {
		t.Fatalf("detalhe nao logado: %s", logText)
	}
	if !strings.Contains(logText, "database is closed") {
		t.Fatalf("log sem o erro original: %s", logText)
	}
	if !strings.Contains(logText, "path=/api/v1/entries/en_inexistente") {
		t.Fatalf("log sem o caminho: %s", logText)
	}
}

// TestNotFoundKeepsMessage garante que o 404 continua com a mensagem propria.
func TestNotFoundKeepsMessage(t *testing.T) {
	srv := newTestServer(t)

	rec, _ := doJSON(t, srv, http.MethodGet, "/api/v1/entries/en_inexistente", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if body := rec.Body.String(); !strings.Contains(body, `"message":"entrada inexistente"`) {
		t.Fatalf("corpo = %s", body)
	}
}
