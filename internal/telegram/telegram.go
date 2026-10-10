// Package telegram is an optional module for receiving audio through a bot. It
// is disabled by default and, when disabled, starts no goroutine and opens no
// connection.
package telegram

import "context"

// Config configures the Telegram module.
type Config struct {
	Enabled  bool
	BotToken string
}

// Bot is the Telegram module.
type Bot struct {
	cfg Config
}

// New builds a Bot.
func New(cfg Config) *Bot { return &Bot{cfg: cfg} }

// Enabled reports whether the module is turned on.
func (b *Bot) Enabled() bool { return b.cfg.Enabled }

// Run starts the bot loop. It is a stub in this phase and returns immediately
// when disabled.
func (b *Bot) Run(ctx context.Context) error {
	<-ctx.Done()
	return nil
}
