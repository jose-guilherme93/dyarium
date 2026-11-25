package mcpserver

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/joseti/dyarium/internal/store"
)

// As chaves do MCP sao as mesmas que a tela de configuracoes grava. O pacote e
// o dono dos limites e dos padroes: a API valida com estes numeros e as
// ferramentas leem com estes numeros, sem duplicar constante.
const (
	SettingPaused          = "mcp_paused"
	SettingIdleHours       = "mcp_idle_hours"
	SettingHistorySessions = "mcp_history_sessions"
	SettingIncludeCommits  = "mcp_include_commits"
	SettingIncludeLinks    = "mcp_include_links"
	SettingStoreFullPath   = "mcp_store_full_path"
	SettingMachineAlias    = "mcp_machine_alias"

	DefaultIdleHours       = 12
	DefaultHistorySessions = 3
	MinIdleHours           = 1
	MaxIdleHours           = 168
	MinHistorySessions     = 0
	MaxHistorySessions     = 10
	MaxMachineAliasRunes   = 80
)

// errPaused is the tool error of a paused MCP. It is returned before any write,
// so a paused server never records a session or a summary.
var errPaused = errors.New("MCP pausado nas configurações")

// Settings is the MCP configuration shared by the tool handlers and the REST
// settings payload. The zero value is not a valid configuration; use
// DefaultSettings or SettingsFrom.
type Settings struct {
	// Paused stops session_open, session_close and record_project_summary.
	Paused bool
	// IdleHours is when an open session reads as interrupted. The state is
	// derived on read; nothing is rewritten because of it.
	IdleHours int
	// HistorySessions is how many previous sessions session_open reports.
	HistorySessions int
	// IncludeCommits and IncludeLinks decide whether the technical block keeps
	// the commits and links sections.
	IncludeCommits bool
	IncludeLinks   bool
	// StoreFullPath keeps the absolute path visible in the history, in the
	// report and in the projects list. The note body always stores the full
	// path; this only changes what is displayed.
	StoreFullPath bool
	// MachineAlias replaces the sanitized host in record_project_summary when
	// it is not empty.
	MachineAlias string
}

// DefaultSettings is the configuration of an instance that never opened the MCP
// screen: MCP running, 12 hours of idle, 3 previous sessions and both sections on.
func DefaultSettings() Settings {
	return Settings{
		IdleHours:       DefaultIdleHours,
		HistorySessions: DefaultHistorySessions,
		IncludeCommits:  true,
		IncludeLinks:    true,
	}
}

// SettingsFrom reads the saved settings. A failed read falls back to the
// defaults on purpose: a settings problem must not take the diary tools down,
// and the next write reads the database again.
func SettingsFrom(ctx context.Context, st *store.Store) Settings {
	if st == nil {
		return DefaultSettings()
	}
	values, err := st.ListSettings(ctx)
	if err != nil {
		return DefaultSettings()
	}
	return SettingsFromValues(values)
}

// SettingsFromValues merges a settings map over the defaults. Values outside the
// contract (a hand-edited database) fall back to the default instead of turning
// into an invalid state for the tools.
func SettingsFromValues(values map[string]string) Settings {
	defaults := DefaultSettings()
	return Settings{
		Paused:          settingBool(values, SettingPaused, defaults.Paused),
		IdleHours:       settingInt(values, SettingIdleHours, defaults.IdleHours, MinIdleHours, MaxIdleHours),
		HistorySessions: settingInt(values, SettingHistorySessions, defaults.HistorySessions, MinHistorySessions, MaxHistorySessions),
		IncludeCommits:  settingBool(values, SettingIncludeCommits, defaults.IncludeCommits),
		IncludeLinks:    settingBool(values, SettingIncludeLinks, defaults.IncludeLinks),
		StoreFullPath:   settingBool(values, SettingStoreFullPath, defaults.StoreFullPath),
		MachineAlias:    normalizeMachineAlias(values[SettingMachineAlias]),
	}
}

// IdleLimit is the idle window as a duration.
func (s Settings) IdleLimit() time.Duration {
	return time.Duration(s.IdleHours) * time.Hour
}

func settingBool(values map[string]string, key string, fallback bool) bool {
	raw, ok := values[key]
	if !ok {
		return fallback
	}
	parsed, err := strconv.ParseBool(strings.TrimSpace(raw))
	if err != nil {
		return fallback
	}
	return parsed
}

func settingInt(values map[string]string, key string, fallback, min, max int) int {
	raw, ok := values[key]
	if !ok {
		return fallback
	}
	parsed, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || parsed < min || parsed > max {
		return fallback
	}
	return parsed
}

// normalizeMachineAlias trims the alias, drops control characters and caps it at
// the configured limit. The API already rejects those values; this keeps a
// hand-edited database from injecting a line break into the note header.
func normalizeMachineAlias(raw string) string {
	raw = strings.TrimSpace(raw)
	var b strings.Builder
	count := 0
	for _, r := range raw {
		if r < 0x20 || r == 0x7f {
			continue
		}
		if count >= MaxMachineAliasRunes {
			break
		}
		b.WriteRune(r)
		count++
	}
	return b.String()
}
