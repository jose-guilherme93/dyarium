package id

import "testing"

func TestValid(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want bool
	}{
		{"ulid com prefixo", "note_01J8Z0000000000000000000A", true},
		{"hex do servidor", "9f8a1b2c3d4e5f60718293a4b5c6d7e8", true},
		{"com hifen", "rec-123-abc", true},
		{"vazio", "", false},
		{"com espaco", "note 1", false},
		{"com barra", "note/1", false},
		{"longo demais", string(make([]byte, 65)), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Valid(tc.in); got != tc.want {
				t.Fatalf("Valid(%q) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}
