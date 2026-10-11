package transcribe

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestParseDeepgramParagraphs(t *testing.T) {
	raw := `{"results":{"channels":[{"detected_language":"pt","alternatives":[
		{"transcript":"Ola mundo.","paragraphs":{"paragraphs":[{"sentences":[
			{"text":"Ola mundo.","start":0.5,"end":1.75}
		]}]}}]}]}}`
	var out deepgramResponse
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	segs, lang := parseDeepgram(out)
	if lang != "pt" {
		t.Fatalf("lang = %q, want pt", lang)
	}
	if len(segs) != 1 || segs[0].StartMS != 500 || segs[0].EndMS != 1750 || segs[0].Text != "Ola mundo." {
		t.Fatalf("segments = %+v", segs)
	}
}

func TestParseDeepgramWords(t *testing.T) {
	raw := `{"results":{"channels":[{"alternatives":[{"transcript":"ola mundo. tchau","words":[
		{"word":"ola","start":0,"end":0.4},
		{"word":"mundo","punctuated_word":"mundo.","start":0.4,"end":0.9},
		{"word":"tchau","start":3.0,"end":3.4}
	]}]}]}}`
	var out deepgramResponse
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	segs, _ := parseDeepgram(out)
	if len(segs) != 2 {
		t.Fatalf("got %d segments, want 2 (%+v)", len(segs), segs)
	}
	if segs[0].Text != "ola mundo." {
		t.Fatalf("segment 0 = %q", segs[0].Text)
	}
	if segs[1].StartMS != 3000 {
		t.Fatalf("segment 1 start = %d", segs[1].StartMS)
	}
}

func TestDeepgramTranscribeRequest(t *testing.T) {
	var gotAuth, gotModel string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotModel = r.URL.Query().Get("model")
		_, _ = w.Write([]byte(`{"results":{"channels":[{"detected_language":"pt","alternatives":[{"transcript":"ola","words":[{"word":"ola","start":0,"end":0.5}]}]}]}}`))
	}))
	defer server.Close()

	f, err := os.CreateTemp("", "dg-*.wav")
	if err != nil {
		t.Fatalf("temp: %v", err)
	}
	defer os.Remove(f.Name())
	f.Write([]byte("fake-audio"))
	f.Close()

	var streamed int
	dg := NewDeepgram("chave-teste", "nova-2", server.URL)
	segs, lang, err := dg.Transcribe(context.Background(), f.Name(), "pt", func(Segment) { streamed++ })
	if err != nil {
		t.Fatalf("transcribe: %v", err)
	}
	if gotAuth != "Token chave-teste" {
		t.Fatalf("auth = %q", gotAuth)
	}
	if gotModel != "nova-2" {
		t.Fatalf("model = %q", gotModel)
	}
	if lang != "pt" || len(segs) != 1 || streamed != 1 {
		t.Fatalf("segs=%+v lang=%q streamed=%d", segs, lang, streamed)
	}
}
