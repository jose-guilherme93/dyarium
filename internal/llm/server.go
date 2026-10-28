package llm

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"sync"
	"time"
)

// Runner is the embedded llama.cpp server as the API and the workers see it.
// The concrete *Server starts the process on demand; tests can substitute it.
type Runner interface {
	BaseURL() string
	Available() bool
	Running() bool
	Acquire(ctx context.Context, modelPath string) (func(), error)
	StopIfIdle()
}

// Server owns one llama-server process bound to loopback. Only one model runs
// at a time; Acquire starts it, and the idle loop releases it when no analysis
// is using it.
type Server struct {
	bin     string
	port    int
	threads int
	idle    time.Duration
	logger  *slog.Logger

	mu       sync.Mutex
	cmd      *exec.Cmd
	running  bool
	inUse    int
	lastUsed time.Time

	stopCh    chan struct{}
	closeOnce sync.Once
	healthURL string
	command   func(name string, args ...string) *exec.Cmd
	client    *http.Client

	availableOnce sync.Once
	available     bool
}

// NewServer builds a Server. An idle duration of 0 disables automatic release.
func NewServer(bin string, port, threads int, idle time.Duration, logger *slog.Logger) *Server {
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	server := &Server{
		bin:       bin,
		port:      port,
		threads:   threads,
		idle:      idle,
		logger:    logger,
		stopCh:    make(chan struct{}),
		healthURL: fmt.Sprintf("http://127.0.0.1:%d/health", port),
		command:   exec.Command,
		client:    &http.Client{Timeout: 3 * time.Second},
	}
	go server.idleLoop()
	return server
}

// BaseURL is the OpenAI-compatible endpoint of the embedded server.
func (s *Server) BaseURL() string {
	return fmt.Sprintf("http://127.0.0.1:%d/v1", s.port)
}

// Available reports whether the llama-server binary exists and can run. A build
// with WITH_LLAMA=0 ships a stub that exits non-zero, so the embedded provider
// correctly appears unavailable instead of failing on the first analysis.
func (s *Server) Available() bool {
	if s == nil {
		return false
	}
	s.availableOnce.Do(func() { s.available = s.probe() })
	return s.available
}

func (s *Server) probe() bool {
	if s.bin == "" {
		return false
	}
	path, err := exec.LookPath(s.bin)
	if err != nil {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, "--version")
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	return cmd.Run() == nil
}

// Running reports whether the process is up.
func (s *Server) Running() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.running
}

// Acquire makes sure the server is up and marks it in use until release is
// called. The idle loop does not stop a server with an analysis in flight.
func (s *Server) Acquire(ctx context.Context, modelPath string) (func(), error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.startLocked(ctx, modelPath); err != nil {
		return nil, err
	}
	s.inUse++
	s.lastUsed = time.Now()
	return func() {
		s.mu.Lock()
		if s.inUse > 0 {
			s.inUse--
		}
		s.lastUsed = time.Now()
		s.mu.Unlock()
	}, nil
}

// StopIfIdle releases the process when no analysis is using it. It is called
// before a transcription so the whisper model is never resident together with
// the language model on a small machine.
func (s *Server) StopIfIdle() {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.running || s.inUse > 0 {
		return
	}
	s.stopLocked()
	s.logger.Info("llama: servidor local liberado antes da transcricao")
}

// Close stops the process and the idle loop. It is safe to call twice.
func (s *Server) Close() {
	if s == nil {
		return
	}
	s.closeOnce.Do(func() { close(s.stopCh) })
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stopLocked()
}

func (s *Server) startLocked(ctx context.Context, modelPath string) error {
	if s.running {
		return nil
	}
	if !s.Available() {
		return fmt.Errorf("%w: binario %s nao encontrado", ErrUnavailable, s.bin)
	}
	if st, err := os.Stat(modelPath); err != nil || st.Size() == 0 {
		return fmt.Errorf("%w: modelo %s nao baixado", ErrUnavailable, modelPath)
	}
	if s.portInUse() {
		// A process killed a moment ago may still be releasing the port.
		if err := s.waitPortFree(ctx); err != nil {
			return err
		}
	}

	args := []string{
		"-m", modelPath,
		"--host", "127.0.0.1",
		"--port", strconv.Itoa(s.port),
		"-c", "8192",
		"-np", "1",
		"-t", strconv.Itoa(s.threads),
		"--no-webui",
	}
	cmd := s.command(s.bin, args...)
	// The server logs are not kept: they may mention request content, and the
	// dashboard only needs the lifecycle events logged below.
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("llm: iniciar: %w", err)
	}
	s.cmd = cmd
	s.running = true
	s.lastUsed = time.Now()
	go s.wait(cmd)

	if err := s.waitHealthy(ctx); err != nil {
		s.stopLocked()
		return err
	}
	s.logger.Info("llama: servidor local pronto", "porta", s.port, "threads", s.threads)
	return nil
}

func (s *Server) wait(cmd *exec.Cmd) {
	err := cmd.Wait()
	s.mu.Lock()
	if s.cmd == cmd {
		s.cmd = nil
		s.running = false
	}
	s.mu.Unlock()
	if err != nil && s.logger != nil {
		s.logger.Debug("llama: processo encerrado", "erro", err)
	}
}

func (s *Server) waitHealthy(ctx context.Context) error {
	deadline := time.Now().Add(60 * time.Second)
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		reqCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, s.healthURL, nil)
		if err == nil {
			resp, doErr := s.client.Do(req)
			if doErr == nil {
				resp.Body.Close()
				if resp.StatusCode == http.StatusOK {
					cancel()
					return nil
				}
			} else if errors.Is(doErr, context.Canceled) {
				cancel()
				return doErr
			}
		}
		cancel()
		if time.Now().After(deadline) {
			return fmt.Errorf("llm: servidor nao respondeu em 60s")
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
}

func (s *Server) portInUse() bool {
	if s.port <= 0 {
		return false
	}
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", s.port), 300*time.Millisecond)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

func (s *Server) waitPortFree(ctx context.Context) error {
	deadline := time.Now().Add(5 * time.Second)
	for s.portInUse() {
		if time.Now().After(deadline) {
			return fmt.Errorf("llm: porta %d ja esta em uso", s.port)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(200 * time.Millisecond):
		}
	}
	return nil
}

func (s *Server) stopLocked() {
	if s.cmd != nil && s.cmd.Process != nil {
		_ = s.cmd.Process.Kill()
	}
	s.cmd = nil
	s.running = false
}

func (s *Server) idleLoop() {
	if s.idle <= 0 {
		return
	}
	interval := s.idle / 4
	if interval < time.Second {
		interval = time.Second
	}
	if interval > 30*time.Second {
		interval = 30 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-s.stopCh:
			return
		case <-ticker.C:
			s.mu.Lock()
			if s.running && s.inUse == 0 && time.Since(s.lastUsed) >= s.idle {
				s.stopLocked()
				s.logger.Info("llama: servidor local liberado por inatividade")
			}
			s.mu.Unlock()
		}
	}
}
