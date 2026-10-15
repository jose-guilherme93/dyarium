package entrytitle

import (
	"testing"
	"time"
)

func TestDefault(t *testing.T) {
	when := time.Date(2026, 10, 15, 13, 41, 0, 0, time.Local)
	cases := []struct {
		label string
		want  string
	}{
		{Audio, "audio · 15/10/2026 13:41"},
		{Text, "texto · 15/10/2026 13:41"},
	}
	for _, tc := range cases {
		if got := Default(tc.label, when); got != tc.want {
			t.Errorf("Default(%q) = %q, want %q", tc.label, got, tc.want)
		}
	}
}

func TestDefaultConvertsToLocal(t *testing.T) {
	when := time.Date(2026, 10, 15, 16, 41, 0, 0, time.UTC)
	got := Default(Audio, when)
	want := "audio · " + when.In(time.Local).Format("02/01/2006 15:04")
	if got != want {
		t.Errorf("Default = %q, want %q", got, want)
	}
}
