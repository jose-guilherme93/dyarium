package entrytitle

import "testing"

func TestName(t *testing.T) {
	cases := []struct {
		label string
		want  string
	}{
		{Audio, "Audio"},
		{Text, "Texto"},
		{"", ""},
	}
	for _, tc := range cases {
		if got := Name(tc.label); got != tc.want {
			t.Errorf("Name(%q) = %q, want %q", tc.label, got, tc.want)
		}
	}
}
