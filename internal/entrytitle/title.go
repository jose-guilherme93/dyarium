// Package entrytitle builds the automatic title of a note. It is used when the
// user does not name the note: the title is just the label for how it started
// (recorded audio or written text); the date is shown separately in the list.
package entrytitle

import "strings"

// Labels used in automatic titles.
const (
	Audio = "audio"
	Text  = "texto"
)

// Name is the automatic title of a note created without a name.
func Name(label string) string {
	if label == "" {
		return ""
	}
	return strings.ToUpper(label[:1]) + label[1:]
}
