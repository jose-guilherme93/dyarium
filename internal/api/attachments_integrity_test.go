package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/joseti/dyarium/internal/id"
)

// outroHash devolve uma string de 64 hex validos, diferente de h.
func outroHash(h string) string {
	if h[63] == '0' {
		return h[:63] + "1"
	}
	return h[:63] + "0"
}

func TestAttachmentIntegritySHA256(t *testing.T) {
	srv := newTestServer(t)
	seedPlainEntry(t, srv, "e1")
	image := bytes.Repeat([]byte("conteudo da imagem de teste para integridade"), 50)
	hash := sha256.Sum256(image)
	sum := hex.EncodeToString(hash[:])

	// 1. hash correto => 201 e anexo criado.
	req := authedRequest(http.MethodPost, "/api/v1/entries/e1/attachments", bytes.NewReader(image))
	req.Header.Set("Content-Type", "image/png")
	req.Header.Set("X-Attachment-Id", id.New())
	req.Header.Set("X-Content-Sha256", sum)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("criar anexo com hash valido: status %d body %s", rec.Code, rec.Body.String())
	}

	// 2. hash errado (64 hex validos, mas diferente) => 422 codigo integrity.
	errHash := outroHash(sum)
	req = authedRequest(http.MethodPost, "/api/v1/entries/e1/attachments", bytes.NewReader(image))
	req.Header.Set("Content-Type", "image/png")
	req.Header.Set("X-Attachment-Id", id.New())
	req.Header.Set("X-Content-Sha256", errHash)
	rec = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("criar anexo com hash divergente: status %d body %s, queria 422", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode corpo do erro: %v", err)
	}
	errBody, _ := body["error"].(map[string]any)
	if errBody["code"] != "integrity" {
		t.Fatalf("codigo do erro = %q, queria integrity", errBody["code"])
	}

	// 3. nenhum anexo criado no caso 422: a lista continua com so o anexo valido.
	rec, list := doJSON(t, srv, http.MethodGet, "/api/v1/entries/e1/attachments", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("listar anexos: status %d", rec.Code)
	}
	attachments, _ := list["attachments"].([]any)
	if len(attachments) != 1 {
		t.Fatalf("esperava 1 anexo (so o valido), obteve %d: %+v", len(attachments), attachments)
	}
}
