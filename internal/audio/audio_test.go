package audio

import (
	"context"
	"os/exec"
	"testing"
)

func TestParseSilences(t *testing.T) {
	stderr := `[silencedetect @ 0x1] silence_start: 1.25
[silencedetect @ 0x1] silence_end: 3.500 | silence_duration: 2.25
[silencedetect @ 0x1] silence_start: 10.0
[silencedetect @ 0x1] silence_end: 11.0 | silence_duration: 1.0
`
	got := parseSilences(stderr)
	if len(got) != 2 {
		t.Fatalf("got %d intervals, want 2", len(got))
	}
	if got[0].StartMS != 1250 || got[0].EndMS != 3500 {
		t.Fatalf("interval 0 = %+v", got[0])
	}
	if got[1].StartMS != 10000 || got[1].EndMS != 11000 {
		t.Fatalf("interval 1 = %+v", got[1])
	}
}

func TestParseLoudnorm(t *testing.T) {
	stderr := `... some noise
{
	"input_i" : "-23.45",
	"input_tp" : "-1.20",
	"input_lra" : "7.10"
}
`
	lufs, peak, err := parseLoudnorm(stderr)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if lufs != -23.45 || peak != -1.20 {
		t.Fatalf("got lufs=%v peak=%v", lufs, peak)
	}
}

func TestDeriveRequiresFfmpeg(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg nao disponivel")
	}
	// A smoke test would need a source file; skipped in unit runs.
	_ = context.Background()
}
