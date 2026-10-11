// Command diary is the single binary for the dyarium spoken diary. It exposes
// the serve and version subcommands.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"github.com/jose-guilherme93/dyarium/internal/analyze"
	"github.com/jose-guilherme93/dyarium/internal/api"
	"github.com/jose-guilherme93/dyarium/internal/audio"
	"github.com/jose-guilherme93/dyarium/internal/config"
	"github.com/jose-guilherme93/dyarium/internal/crypto"
	"github.com/jose-guilherme93/dyarium/internal/events"
	"github.com/jose-guilherme93/dyarium/internal/ingest"
	"github.com/jose-guilherme93/dyarium/internal/jobs"
	"github.com/jose-guilherme93/dyarium/internal/models"
	"github.com/jose-guilherme93/dyarium/internal/store"
	"github.com/jose-guilherme93/dyarium/internal/telegram"
	"github.com/jose-guilherme93/dyarium/internal/transcribe"
)

// Build metadata, overridden at link time via -ldflags "-X main.version=...".
var (
	version = "dev"
	commit  = "none"
	date    = "unknown"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	switch os.Args[1] {
	case "serve":
		if err := serve(); err != nil {
			fmt.Fprintln(os.Stderr, "erro:", err)
			os.Exit(1)
		}
	case "version":
		fmt.Printf("dyarium %s (commit %s, built %s)\n", version, commit, date)
	case "help", "-h", "--help":
		usage()
	default:
		fmt.Fprintf(os.Stderr, "subcomando desconhecido: %s\n\n", os.Args[1])
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Fprint(os.Stderr, `uso: diary <subcomando>

subcomandos:
  serve     inicia a API HTTP, os workers e o dashboard
  version   imprime a versao e sai
`)
}

func serve() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: parseLevel(cfg.LogLevel)}))
	slog.SetDefault(logger)

	key, err := crypto.ParseKey(cfg.MasterKey)
	if err != nil {
		return fmt.Errorf("chave mestra invalida: %w", err)
	}

	st, err := store.Open(cfg.DBPath)
	if err != nil {
		return err
	}
	defer st.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := st.Migrate(ctx); err != nil {
		return err
	}
	if err := seedSettings(ctx, st, cfg); err != nil {
		return err
	}

	prober := audio.NewProber(cfg.FFmpegBin, cfg.FFprobeBin)
	ingestSvc := ingest.New(ingest.Config{
		MaxUploadBytes:     cfg.MaxUploadBytes,
		MaxDurationSeconds: cfg.MaxDurationSeconds,
		AllowedFormats:     cfg.AllowedFormats,
	}, st, key, cfg.DataDir, prober)

	queue := jobs.NewQueue(st.DB())
	analyzer := analyze.New(analyze.Config{
		Enabled: cfg.AnalyzeEnabled,
		BaseURL: cfg.AnalyzeBaseURL,
		APIKey:  cfg.AnalyzeAPIKey,
		Model:   cfg.AnalyzeModel,
	})
	bus := events.NewBus()

	checkpointDir := filepath.Join(cfg.DataDir, "checkpoints")
	whisper := transcribe.NewWhisperCLI(cfg.WhisperBin, cfg.WhisperModel, "")
	runtime := func(ctx context.Context) transcribe.Runtime {
		get := func(key string) string {
			if v, ok, err := st.GetSetting(ctx, key); err == nil && ok {
				return v
			}
			return ""
		}
		mb, _ := strconv.ParseInt(get("max_whisper_rss_mb"), 10, 64)
		provider := get("transcribe_provider")
		if provider == "" {
			provider = "whisper"
		}
		return transcribe.Runtime{
			Provider:        provider,
			Model:           get("whisper_model"),
			Language:        get("whisper_language"),
			MaxRSSMB:        mb,
			DeepgramKey:     get("deepgram_api_key"),
			DeepgramModel:   get("deepgram_model"),
			DeepgramBaseURL: cfg.DeepgramBaseURL,
		}
	}
	pipeline := transcribe.NewPipeline(st, transcribe.RealDeps(ingestSvc, prober, whisper, runtime), checkpointDir, cfg.WhisperModel)

	modelsMgr := models.NewManager(cfg.ModelsDir, cfg.ModelsBaseURL, bus)
	canceller := jobs.NewCanceller()

	startWorkers(ctx, cfg, st, queue, pipeline, bus, logger, canceller)

	if cfg.TelegramEnabled {
		bot := telegram.New(telegram.Config{Enabled: true, BotToken: cfg.TelegramBotToken, APIBase: cfg.TelegramAPIBase})
		sink := telegramSink{ingest: ingestSvc, queue: queue, store: st, bus: bus}
		go func() {
			if err := bot.Run(ctx, sink); err != nil {
				logger.Error("telegram: encerrado com erro", "erro", err)
			}
		}()
		logger.Info("modulo telegram habilitado")
	}

	srv := api.New(api.Deps{
		Config:    cfg,
		Store:     st,
		Logger:    logger,
		Version:   api.Version{Version: version, Commit: commit, BuiltAt: date},
		Ingest:    ingestSvc,
		Queue:     queue,
		Analyzer:  analyzer,
		Events:    bus,
		Models:    modelsMgr,
		Canceller: canceller,
	})

	httpServer := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	errCh := make(chan error, 1)
	go func() {
		logger.Info("servindo", "addr", cfg.HTTPAddr, "version", version, "workers", cfg.WorkerConcurrency)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	select {
	case err := <-errCh:
		return err
	case sig := <-stop:
		logger.Info("encerrando", "signal", sig.String())
	}
	cancel()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	return httpServer.Shutdown(shutdownCtx)
}

func startWorkers(ctx context.Context, cfg config.Config, st *store.Store, queue *jobs.Queue, pipeline *transcribe.Pipeline, bus *events.Bus, logger *slog.Logger, canceller *jobs.Canceller) {
	lease := time.Duration(cfg.JobLeaseSeconds) * time.Second
	transcribeH := transcribeHandler(st, cfg, pipeline, queue, bus, logger)
	analyzeH := analyzeHandler(st, cfg, bus, logger)
	for i := 0; i < cfg.WorkerConcurrency; i++ {
		runner := jobs.NewRunner(queue, fmt.Sprintf("worker-%d", i+1), lease, 2*time.Second, logger, canceller)
		runner.Register(jobs.TypeTranscribe, transcribeH)
		runner.Register(jobs.TypeAnalyze, analyzeH)
		go runner.Run(ctx)
	}
	logger.Info("workers iniciados", "quantidade", cfg.WorkerConcurrency)
}

func seedSettings(ctx context.Context, st *store.Store, cfg config.Config) error {
	defaults := map[string]string{
		"trim_silence":        strconv.FormatBool(cfg.TrimSilence),
		"max_whisper_rss_mb":  strconv.Itoa(cfg.MaxWhisperRSSMB),
		"whisper_model":       cfg.WhisperModel,
		"whisper_language":    cfg.WhisperLanguage,
		"transcribe_provider": "whisper",
		"deepgram_model":      "nova-2",
		"analyze_enabled":     strconv.FormatBool(cfg.AnalyzeEnabled),
		"analyze_base_url":    cfg.AnalyzeBaseURL,
		"analyze_model":       cfg.AnalyzeModel,
	}
	for key, value := range defaults {
		if _, ok, err := st.GetSetting(ctx, key); err != nil {
			return err
		} else if !ok {
			if err := st.SetSetting(ctx, key, value); err != nil {
				return err
			}
		}
	}
	return nil
}

func parseLevel(s string) slog.Level {
	switch s {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
