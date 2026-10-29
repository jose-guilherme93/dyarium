package analyze

import (
	"net/url"
	"strings"
)

// Origin values stored with an analysis. "server" means the text stayed on this
// machine (a local Ollama or a local OpenCode); "api" means it was sent to a
// hosted provider. The app sends its own analyses as "app".
const (
	OriginServer = "server"
	OriginAPI    = "api"
	OriginApp    = "app"
	// OriginBrowser is an analysis made by the optional dashboard worker, on the
	// user's own computer. The text never reached a provider, but it is not the
	// phone either: the dashboard can say "neste PC".
	OriginBrowser = "browser"
)

// localHosts are hostnames that mean "this machine" (or the container next to
// it) without a network round trip leaving the deployment.
var localHosts = map[string]bool{
	"localhost":            true,
	"127.0.0.1":            true,
	"::1":                  true,
	"0.0.0.0":              true,
	"host.docker.internal": true,
	"ollama":               true,
}

// Origin reports whether the configured provider runs inside this deployment or
// is a hosted API. It is about where the text goes, not about which code calls
// it: the dashboard uses it to say "site web" or "API".
func (c Config) Origin() string {
	raw := strings.TrimSpace(c.BaseURL)
	if raw == "" {
		return OriginServer
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Hostname() == "" {
		return OriginServer
	}
	if localHosts[strings.ToLower(parsed.Hostname())] {
		return OriginServer
	}
	return OriginAPI
}
