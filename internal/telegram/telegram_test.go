package telegram_test

import (
	"context"
	"testing"

	"github.com/jose-guilherme93/dyarium/internal/telegram"
)

func TestDisabledDoesNothing(t *testing.T) {
	bot := telegram.New(telegram.Config{Enabled: false})
	if bot.Enabled() {
		t.Fatal("bot deveria estar desligado")
	}
	// A nil sink is safe because the module must not touch anything when off.
	if err := bot.Run(context.Background(), nil); err != nil {
		t.Fatalf("run desligado retornou erro: %v", err)
	}
}

func TestEnabledRequiresConfig(t *testing.T) {
	bot := telegram.New(telegram.Config{Enabled: true})
	if err := bot.Run(context.Background(), nil); err == nil {
		t.Fatal("esperava erro de configuracao com o modulo habilitado")
	}
}
