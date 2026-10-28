// Package ollama talks to a local Ollama server: listing installed models and
// pulling one, so the dashboard can turn local analysis on with a single click
// without the user typing a URL or running a command.
package ollama

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// Progress is one event of a model pull. Total is 0 while Ollama is still
// resolving the manifest.
type Progress struct {
	Status    string
	Completed int64
	Total     int64
}

// Endpoint derives the Ollama root from the OpenAI-compatible base URL used by
// the analysis client ("http://host:11434/v1" -> "http://host:11434").
func Endpoint(baseURL string) string {
	root := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	root = strings.TrimSuffix(root, "/v1")
	return strings.TrimRight(root, "/")
}

// modelName rejects absurd input before it reaches the pull endpoint. Ollama
// names are "model:tag" and may carry a namespace ("hf.co/user/model").
var modelName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`)

// ValidModel reports whether name looks like an Ollama model reference.
func ValidModel(name string) bool {
	return modelName.MatchString(strings.TrimSpace(name))
}

// Tags lists the models already installed on the server.
func Tags(ctx context.Context, root string) ([]string, error) {
	if root == "" {
		return nil, errors.New("ollama: endereco vazio")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, root+"/api/tags", nil)
	if err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("ollama: tags: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ollama: tags: status %d", resp.StatusCode)
	}
	var payload struct {
		Models []struct {
			Name  string `json:"name"`
			Model string `json:"model"`
		} `json:"models"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("ollama: tags: %w", err)
	}
	models := make([]string, 0, len(payload.Models))
	seen := map[string]bool{}
	for _, model := range payload.Models {
		name := model.Name
		if name == "" {
			name = model.Model
		}
		if name != "" && !seen[name] {
			seen[name] = true
			models = append(models, name)
		}
	}
	return models, nil
}

// HasModel reports whether name is already installed.
func HasModel(models []string, name string) bool {
	for _, model := range models {
		if model == name {
			return true
		}
	}
	return false
}

// Pull downloads a model, reporting progress until Ollama answers "success".
// The caller owns the context: it should carry a generous deadline, since a
// model may take several minutes on a slow connection.
func Pull(ctx context.Context, root, name string, report func(Progress)) error {
	if root == "" {
		return errors.New("ollama: endereco vazio")
	}
	if !ValidModel(name) {
		return errors.New("ollama: nome de modelo invalido")
	}
	body, err := json.Marshal(map[string]any{"name": name, "stream": true})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, root+"/api/pull", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("ollama: pull: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
		return fmt.Errorf("ollama: pull: status %d: %s", resp.StatusCode, strings.TrimSpace(string(snippet)))
	}

	decoder := json.NewDecoder(resp.Body)
	for {
		var event struct {
			Status    string `json:"status"`
			Total     int64  `json:"total"`
			Completed int64  `json:"completed"`
			Error     string `json:"error"`
		}
		if err := decoder.Decode(&event); err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return fmt.Errorf("ollama: pull: %w", err)
		}
		if event.Error != "" {
			return fmt.Errorf("ollama: pull: %s", event.Error)
		}
		if report != nil {
			report(Progress{Status: event.Status, Completed: event.Completed, Total: event.Total})
		}
		if event.Status == "success" {
			return nil
		}
	}
}
