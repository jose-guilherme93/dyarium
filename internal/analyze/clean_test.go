package analyze

import "testing"

func TestCleanText(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{
			name: "html e entidades preservam paragrafos",
			in:   "<div>Primeiro <b>paragrafo</b> com&nbsp;espaco.</div><div>Segundo &amp; ultimo&nbsp;paragrafo.</div>",
			want: "Primeiro paragrafo com espaco.\n\nSegundo & ultimo paragrafo.",
		},
		{
			name: "script style e comentario somem",
			in:   `Antes. <script>alert("lixo")</script><style>.a{color:red}</style><!-- nota --> Depois.`,
			want: "Antes. Depois.",
		},
		{
			name: "cerca de codigo inteira",
			in:   "Antes.\n\n```ts\nconst x = 1;\n```\n\nDepois.",
			want: "Antes.\n\nDepois.",
		},
		{
			name: "imagem audio link e url",
			in:   "Vi a foto ![praia](attachment:abc){w=50} e ouvi !audio[attachment:abc]{d=3.5}. Veja [a nota](note:abc) e [o site](https://exemplo.com/x). Link solto https://exemplo.com/y e www.exemplo.com.",
			want: "Vi a foto e ouvi. Veja a nota e o site. Link solto e.",
		},
		{
			name: "marcadores e carimbo de tempo",
			in:   "# Titulo\n\n- item **forte**\n- item _leve_\n\n> citacao\n\n[00:12] fala",
			want: "Titulo\n\nitem forte item leve\n\ncitacao\n\nfala",
		},
		{
			name: "emoji invisivel e controle",
			in:   "Bom dia \U0001f600\u200b! Tudo\x07 bem\u00ad?",
			want: "Bom dia! Tudo bem?",
		},
		{
			name: "linha so de simbolo",
			in:   "Texto.\n---\n***\nOutro texto.",
			want: "Texto.\n\nOutro texto.",
		},
		{
			name: "espaco e idempotencia",
			in:   "  Um   texto\tcom   espacos.  \n\n\nOutro.  ",
			want: "Um texto com espacos.\n\nOutro.",
		},
		{
			name: "ruido",
			in:   "<div><script>x()</script></div>",
			want: "",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := CleanText(tc.in)
			if got != tc.want {
				t.Fatalf("CleanText =\n%q\nwant\n%q", got, tc.want)
			}
			if again := CleanText(got); again != got {
				t.Fatalf("CleanText nao e idempotente:\n%q\n%q", got, again)
			}
		})
	}
}

func TestBuildWindowsCleansSegmentText(t *testing.T) {
	windows := buildWindows([]Segment{
		{StartMS: 0, Text: "<div>Oi <b>Ana</b>.</div>"},
		{StartMS: 1500, Text: "Bom dia \U0001f600!"},
	})
	if len(windows) != 1 {
		t.Fatalf("janelas = %d, queria 1", len(windows))
	}
	want := "[00:00] Oi Ana.\n[00:01] Bom dia!"
	if windows[0].text != want {
		t.Fatalf("janela = %q, want %q", windows[0].text, want)
	}
}
