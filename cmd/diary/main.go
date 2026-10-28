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

	"github.com/joseti/dyarium/internal/analyze"
	"github.com/joseti/dyarium/internal/api"
	"github.com/joseti/dyarium/internal/audio"
	"github.com/joseti/dyarium/internal/config"
	"github.com/joseti/dyarium/internal/crypto"
	"github.com/joseti/dyarium/internal/events"
	"github.com/joseti/dyarium/internal/ingest"
	"github.com/joseti/dyarium/internal/jobs"
	"github.com/joseti/dyarium/internal/llm"
	"github.com/joseti/dyarium/internal/models"
	"github.com/joseti/dyarium/internal/store"
	"github.com/joseti/dyarium/internal/telegram"
	"github.com/joseti/dyarium/internal/transcribe"
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
	case "dedupe":
		if err := dedupe(len(os.Args) > 2 && os.Args[2] == "--dry-run"); err != nil {
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
  dedupe    mescla as notas duplicadas do mesmo audio (--dry-run)
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
	// Reparo de dados da rodada anterior: o dashboard antigo gravou a URL do
	// anexo (com o token) como HTML no corpo. Converte para `attachment:<id>` e
	// remove o token de corpos e revisoes. Idempotente.
	if notes, revs, err := st.ScrubAttachmentTokens(ctx); err != nil {
		logger.Error("store: limpar tokens de anexos", "erro", err)
	} else if notes+revs > 0 {
		logger.Info("store: tokens de anexos removidos", "notas", notes, "revisoes", revs)
	}
	// Nota com transcricao feita no aparelho nao pode continuar marcada como
	// falha: o texto esta salvo, so o job do servidor falhou. Idempotente.
	if fixed, err := st.RepairDeviceTranscripts(ctx); err != nil {
		logger.Error("store: reparar transcricoes locais", "erro", err)
	} else if fixed > 0 {
		logger.Info("store: notas com transcricao local marcadas como transcritas", "quantidade", fixed)
	}
	// Transcricao solta (salva antes do audio existir) volta a apontar para o
	// audio da nota: sem isso o dashboard mostra a nota transcrita sem texto.
	if linked, err := st.LinkLooseTranscripts(ctx); err != nil {
		logger.Error("store: ligar transcricoes soltas", "erro", err)
	} else if linked > 0 {
		logger.Info("store: transcricoes ligadas ao audio", "quantidade", linked)
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
	if expired, err := queue.ExpireStaleRetries(ctx, 24*time.Hour); err != nil {
		logger.Error("fila: expirar retries antigos", "erro", err)
	} else if expired > 0 {
		logger.Info("fila: retries antigos expirados", "quantidade", expired)
	}
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
	llmMgr := llm.NewManager(cfg.ModelsDir)
	llamaServer := llm.NewServer(cfg.LlamaServerBin, cfg.LlamaPort, cfg.LlamaThreads,
		time.Duration(cfg.LlamaIdleSeconds)*time.Second, logger)
	defer llamaServer.Close()
	canceller := jobs.NewCanceller()

	startWorkers(ctx, cfg, st, ingestSvc, queue, pipeline, bus, logger, canceller, llamaServer, llmMgr)

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
		LocalAI:   llamaServer,
		LLMModels: llmMgr,
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

func startWorkers(ctx context.Context, cfg config.Config, st *store.Store, ing *ingest.Service, queue *jobs.Queue, pipeline *transcribe.Pipeline, bus *events.Bus, logger *slog.Logger, canceller *jobs.Canceller, localAI llm.Runner, llmModels llm.Store) {
	lease := time.Duration(cfg.JobLeaseSeconds) * time.Second
	transcribeH := transcribeHandler(st, cfg, pipeline, queue, bus, logger, localAI)
	analyzeH := analyzeHandler(st, cfg, bus, logger, localAI, llmModels)
	cleanupH := cleanupHandler(st, ing, logger)
	for i := 0; i < cfg.WorkerConcurrency; i++ {
		runner := jobs.NewRunner(queue, fmt.Sprintf("worker-%d", i+1), lease, 2*time.Second, logger, canceller)
		runner.Register(jobs.TypeTranscribe, transcribeH)
		runner.Register(jobs.TypeAnalyze, analyzeH)
		runner.Register(jobs.TypeCleanup, cleanupH)
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
