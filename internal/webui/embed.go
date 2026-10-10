// Package webui embeds the compiled dashboard assets into the binary.
package webui

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var embedded embed.FS

// Dist returns the dashboard assets rooted at the embedded dist directory.
func Dist() (fs.FS, error) {
	return fs.Sub(embedded, "dist")
}
