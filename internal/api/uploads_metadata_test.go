package api

import (
	"net/http"
	"strings"
	"testing"
)

func TestCreateUploadMetadata(t *testing.T) {
	srv := newTestServer(t)
	cases := []struct {
		name    string
		payload string
		want    int
	}{
		{
			name:    "created_at invalido",
			payload: `{"filename":"a.wav","content_type":"audio/wav","size_bytes":1,"created_at":"ontem"}`,
			want:    http.StatusBadRequest,
		},
		{
			name:    "origem invalida",
			payload: `{"filename":"a.wav","content_type":"audio/wav","size_bytes":1,"source":"desconhecida"}`,
			want:    http.StatusBadRequest,
		},
		{
			name:    "share com data original",
			payload: `{"filename":"a.wav","content_type":"audio/wav","size_bytes":1,"created_at":"2023-10-19T13:30:00Z","source":"share"}`,
			want:    http.StatusCreated,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec, _ := doJSON(t, srv, http.MethodPost, "/api/v1/uploads", strings.NewReader(tc.payload))
			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d (%s)", rec.Code, tc.want, rec.Body.String())
			}
		})
	}
}
