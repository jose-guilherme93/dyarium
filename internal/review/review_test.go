package review

import "testing"

func TestSpeakCountsStutterAndHesitationApart(t *testing.T) {
	// "eu eu" e gagueira; "ee" e hesitacao; "tipo" e "ne" sao fala legitima.
	counts := Speak("eu eu falei, tipo assim, ne? ee entao")
	if counts.Words != 8 {
		t.Fatalf("palavras = %d, queria 8", counts.Words)
	}
	if counts.Stutter != 1 {
		t.Fatalf("gagueira = %d, queria 1", counts.Stutter)
	}
	if counts.Hesitation != 1 {
		t.Fatalf("hesitacao = %d, queria 1", counts.Hesitation)
	}
}

func TestSpeakPreservesEmphaticRepetition(t *testing.T) {
	// "nao nao" e enfase, nao gagueira.
	if counts := Speak("nao nao quero"); counts.Stutter != 0 {
		t.Fatalf("gagueira = %d, queria 0", counts.Stutter)
	}
}

func TestPerHundred(t *testing.T) {
	if got := PerHundred(2, 100); got != 2 {
		t.Fatalf("taxa = %v, queria 2", got)
	}
	if got := PerHundred(1, 0); got != 0 {
		t.Fatalf("taxa sem palavras = %v, queria 0", got)
	}
}

func TestAcceptAllowsGrammarAndAcronymGloss(t *testing.T) {
	ok, reason := Accept(
		"a sede do pt fica em sao paulo, ne",
		"A sede do PT (Partido dos Trabalhadores) fica em Sao Paulo, ne?",
	)
	if !ok {
		t.Fatalf("revisao recusada: %s", reason)
	}
}

func TestAcceptRejectsChangedNumbers(t *testing.T) {
	if ok, reason := Accept("foram 3 pessoas", "foram 4 pessoas"); ok {
		t.Fatalf("aceitou numero trocado (%s)", reason)
	}
	if ok, reason := Accept("foram 3 pessoas", "foram 3 pessoas, um casal"); ok {
		t.Fatalf("aceitou numero novo (%s)", reason)
	}
}

func TestAcceptRejectsFullRewrite(t *testing.T) {
	if ok, _ := Accept(
		"hoje eu acordei cedo e fui caminhar na praia com o cachorro",
		"o dia comecou bem cedo com uma caminhada diferente",
	); ok {
		t.Fatal("aceitou uma reescrita que troca quase todas as palavras")
	}
}

func TestAcceptRejectsTwoGlosses(t *testing.T) {
	if ok, reason := Accept(
		"pt e stf decidiram",
		"PT (Partido dos Trabalhadores) e STF (Supremo Tribunal Federal) decidiram",
	); ok {
		t.Fatalf("aceitou duas explicacoes (%s)", reason)
	}
}

func TestAcceptKeepsHesitationWhenLiteral(t *testing.T) {
	// A regra de aceitacao e sobre conteudo; remover hesitacao do texto nao
	// invalida a revisao.
	if ok, reason := Accept("ee eu eu falei isso", "eu falei isso"); !ok {
		t.Fatalf("recusou remocao de hesitacao: %s", reason)
	}
}
