// Package config loads runtime configuration from environment variables.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Config holds all runtime configuration. Values come exclusively from the
// environment so that no secret, domain or IP is ever hardcoded.
type Config struct {
	HTTPAddr           string
	Token              string
	MasterKey          string
	DBPath             string
	DataDir            string
	ModelsDir          string
	ModelsBaseURL      string
	WhisperBin         string
	WhisperModel       string
	WhisperLanguage    string
	DeepgramBaseURL    string
	FFmpegBin          string
	FFprobeBin         string
	AnalyzeEnabled     bool
	AnalyzeProvider    string
	AnalyzeBaseURL     string
	AnalyzeAPIKey      string
	AnalyzeModel       string
	MaxUploadBytes     int64
	MaxDurationSeconds int
	AllowedFormats     []string
	MaxWhisperRSSMB    int
	TrimSilence        bool
	WorkerConcurrency  int
	JobLeaseSeconds    int
	LogLevel           string
	TelegramEnabled    bool
	TelegramBotToken   string
	TelegramAPIBase    string
	LitestreamEnabled  bool
	LitestreamBucket   string
	LitestreamPath     string
	LitestreamEndpoint string
	LitestreamAccessID string
	LitestreamSecret   string
}

// Load reads configuration from the environment, applying safe defaults.
func Load() (Config, error) {
	cfg := Config{
		HTTPAddr:           env("DIARY_HTTP_ADDR", ":8080"),
		Token:              env("DIARY_TOKEN", ""),
		MasterKey:          env("DIARY_MASTER_KEY", ""),
		DBPath:             env("DIARY_DB_PATH", "data/diary.db"),
		DataDir:            env("DIARY_DATA_DIR", "data"),
		ModelsDir:          env("DIARY_MODELS_DIR", "models"),
		ModelsBaseURL:      env("DIARY_MODELS_BASE_URL", "https://huggingface.co/ggerganov/whisper.cpp/resolve/main"),
		WhisperBin:         env("DIARY_WHISPER_BIN", "whisper-cli"),
		WhisperModel:       env("DIARY_WHISPER_MODEL", "models/ggml-small-q5_1.bin"),
		WhisperLanguage:    env("DIARY_WHISPER_LANGUAGE", ""),
		DeepgramBaseURL:    env("DIARY_DEEPGRAM_BASE_URL", "https://api.deepgram.com"),
		FFmpegBin:          env("DIARY_FFMPEG_BIN", "ffmpeg"),
		FFprobeBin:         env("DIARY_FFPROBE_BIN", "ffprobe"),
		AnalyzeEnabled:     envBool("DIARY_ANALYZE_ENABLED", false),
		AnalyzeProvider:    env("DIARY_ANALYZE_PROVIDER", "openai"),
		AnalyzeBaseURL:     env("DIARY_ANALYZE_BASE_URL", "http://localhost:11434/v1"),
		AnalyzeAPIKey:      env("DIARY_ANALYZE_API_KEY", ""),
		AnalyzeModel:       env("DIARY_ANALYZE_MODEL", ""),
		MaxUploadBytes:     envInt64("DIARY_MAX_UPLOAD_BYTES", 2<<30),
		MaxDurationSeconds: envInt("DIARY_MAX_DURATION_SECONDS", 3000),
		AllowedFormats:     splitList(env("DIARY_ALLOWED_FORMATS", "wav,mp3,m4a,ogg,flac,aac,adts,webm")),
		MaxWhisperRSSMB:    envInt("DIARY_MAX_WHISPER_RSS_MB", 0),
		TrimSilence:        envBool("DIARY_TRIM_SILENCE", false),
		WorkerConcurrency:  envInt("DIARY_WORKER_CONCURRENCY", 1),
		JobLeaseSeconds:    envInt("DIARY_JOB_LEASE_SECONDS", 120),
		LogLevel:           env("DIARY_LOG_LEVEL", "info"),
		TelegramEnabled:    envBool("DIARY_TELEGRAM_ENABLED", false),
		TelegramBotToken:   env("DIARY_TELEGRAM_BOT_TOKEN", ""),
		TelegramAPIBase:    env("DIARY_TELEGRAM_API_BASE", ""),
		LitestreamEnabled:  envBool("DIARY_LITESTREAM_ENABLED", false),
		LitestreamBucket:   env("DIARY_LITESTREAM_BUCKET", ""),
		LitestreamPath:     env("DIARY_LITESTREAM_PATH", ""),
		LitestreamEndpoint: env("DIARY_LITESTREAM_ENDPOINT", ""),
		LitestreamAccessID: env("DIARY_LITESTREAM_ACCESS_KEY_ID", ""),
		LitestreamSecret:   env("DIARY_LITESTREAM_SECRET_ACCESS_KEY", ""),
	}

	if cfg.Token == "" {
		return Config{}, fmt.Errorf("DIARY_TOKEN is required")
	}
	if cfg.MasterKey == "" {
		return Config{}, fmt.Errorf("DIARY_MASTER_KEY is required")
	}
	if cfg.WorkerConcurrency < 1 {
		return Config{}, fmt.Errorf("DIARY_WORKER_CONCURRENCY must be at least 1")
	}
	return cfg, nil
}

func env(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

func envBool(key string, def bool) bool {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return def
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return def
	}
	return b
}

func envInt(key string, def int) int {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func envInt64(key string, def int64) int64 {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return def
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return def
	}
	return n
}

func splitList(v string) []string {
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(strings.ToLower(p))
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
