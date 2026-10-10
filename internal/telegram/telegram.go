// Package telegram is an optional module for receiving audio through a bot. It
// is disabled by default: when disabled, Run returns immediately and starts no
// goroutine, no connection and no polling.
package telegram

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"
	"time"
)

// Config configures the Telegram module.
type Config struct {
	Enabled  bool
	BotToken string
	APIBase  string
}

// Sink receives downloaded audio.
type Sink interface {
	IngestAudio(ctx context.Context, source, filename, contentType string, data io.Reader) (string, error)
}

// Bot is the Telegram module.
type Bot struct {
	cfg  Config
	http *http.Client
}

// New builds a Bot.
func New(cfg Config) *Bot {
	return &Bot{cfg: cfg, http: &http.Client{Timeout: 90 * time.Second}}
}

// Enabled reports whether the module is turned on.
func (b *Bot) Enabled() bool { return b.cfg.Enabled }

type update struct {
	UpdateID int64 `json:"update_id"`
	Message  *struct {
		Voice *struct {
			FileID   string `json:"file_id"`
			MimeType string `json:"mime_type"`
		} `json:"voice"`
		Audio *struct {
			FileID   string `json:"file_id"`
			MimeType string `json:"mime_type"`
			FileName string `json:"file_name"`
		} `json:"audio"`
	} `json:"message"`
}

// Run polls Telegram for audio messages until the context is cancelled. It is a
// no-op when disabled.
func (b *Bot) Run(ctx context.Context, sink Sink) error {
	if !b.cfg.Enabled {
		return nil
	}
	if b.cfg.BotToken == "" || b.cfg.APIBase == "" {
		return errors.New("telegram: token e api base sao obrigatorios quando habilitado")
	}
	var offset int64
	for {
		select {
		case <-ctx.Done():
			return nil
		default:
		}
		updates, err := b.getUpdates(ctx, offset)
		if err != nil {
			select {
			case <-ctx.Done():
				return nil
			case <-time.After(3 * time.Second):
			}
			continue
		}
		for _, u := range updates {
			if u.UpdateID >= offset {
				offset = u.UpdateID + 1
			}
			if err := b.handle(ctx, u, sink); err != nil {
				_ = err
			}
		}
	}
}

func (b *Bot) handle(ctx context.Context, u update, sink Sink) error {
	if u.Message == nil {
		return nil
	}
	var fileID, filename, contentType string
	switch {
	case u.Message.Voice != nil:
		fileID = u.Message.Voice.FileID
		filename = "voice.ogg"
		contentType = u.Message.Voice.MimeType
	case u.Message.Audio != nil:
		fileID = u.Message.Audio.FileID
		filename = u.Message.Audio.FileName
		contentType = u.Message.Audio.MimeType
	default:
		return nil
	}
	filePath, err := b.getFilePath(ctx, fileID)
	if err != nil {
		return err
	}
	if filename == "" {
		filename = path.Base(filePath)
	}
	resp, err := b.http.Get(b.fileURL(filePath))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("telegram: download status %d", resp.StatusCode)
	}
	_, err = sink.IngestAudio(ctx, "telegram", filename, contentType, resp.Body)
	return err
}

func (b *Bot) getUpdates(ctx context.Context, offset int64) ([]update, error) {
	payload := map[string]any{"offset": offset, "timeout": 30, "allowed_updates": []string{"message"}}
	var out struct {
		OK     bool     `json:"ok"`
		Result []update `json:"result"`
	}
	if err := b.call(ctx, "getUpdates", payload, &out); err != nil {
		return nil, err
	}
	return out.Result, nil
}

func (b *Bot) getFilePath(ctx context.Context, fileID string) (string, error) {
	var out struct {
		OK     bool `json:"ok"`
		Result struct {
			FilePath string `json:"file_path"`
		} `json:"result"`
	}
	if err := b.call(ctx, "getFile", map[string]any{"file_id": fileID}, &out); err != nil {
		return "", err
	}
	return out.Result.FilePath, nil
}

func (b *Bot) call(ctx context.Context, method string, payload any, out any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	url := fmt.Sprintf("%s/bot%s/%s", strings.TrimRight(b.cfg.APIBase, "/"), b.cfg.BotToken, method)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := b.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return json.NewDecoder(resp.Body).Decode(out)
}

func (b *Bot) fileURL(filePath string) string {
	return fmt.Sprintf("%s/file/bot%s/%s", strings.TrimRight(b.cfg.APIBase, "/"), b.cfg.BotToken, filePath)
}
