package store

import "testing"

// A paleta e compartilhada com os clientes: o tema usa a peca de quebra-cabeca,
// entao a chave precisa ser aceita ao salvar um icone personalizado.
func TestValidGraphIcon(t *testing.T) {
	if !ValidGraphIcon("puzzle") {
		t.Fatal("puzzle deveria ser uma chave valida")
	}
	if !ValidGraphIcon("hash") {
		t.Fatal("hash continua valido como icone personalizado")
	}
	if ValidGraphIcon("nao-existe") {
		t.Fatal("chave fora da paleta deveria ser recusada")
	}
}
