package analyze

import "strings"

// ConfigFromSettings merges the environment defaults with the values saved in
// the dashboard. The API and the worker must ask the provider through the same
// configuration: the preflight ping that runs on the click has to test exactly
// what the analysis is going to use.
func ConfigFromSettings(base Config, settings map[string]string) Config {
	result := base
	if settings == nil {
		return result
	}
	if v, ok := settings["analyze_enabled"]; ok {
		result.Enabled = v == "true"
	}
	if v, ok := settings["analyze_provider"]; ok && v != "" {
		result.Provider = v
	}
	if v, ok := settings["analyze_local_runtime"]; ok {
		result.LocalRuntime = strings.TrimSpace(v)
	}
	if v, ok := settings["analyze_base_url"]; ok && v != "" {
		result.BaseURL = v
	}
	if v, ok := settings["analyze_api_key"]; ok {
		result.APIKey = v
	}
	if v, ok := settings["analyze_model"]; ok && v != "" {
		result.Model = v
	}
	if v, ok := settings["analysis_themes"]; ok && strings.TrimSpace(v) != "" {
		result.Themes = ParseThemes(v)
	}
	if v, ok := settings["owner_name"]; ok {
		result.OwnerName = strings.TrimSpace(v)
	}
	if v, ok := settings["all_notes_mine"]; ok {
		result.AllNotesMine = v == "true"
	} else {
		// Ausente e o padrao de uma instancia nova: todas as notas sao do dono.
		result.AllNotesMine = true
	}
	return result
}
