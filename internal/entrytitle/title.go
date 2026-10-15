// Package entrytitle builds the automatic, semantic title of a note. It is used
// when the user does not name the note: the title combines how the note started
// (recorded audio or written text) with its date and time.
package entrytitle

import (
	"fmt"
	"time"
)

// Labels used in automatic titles.
const (
	Audio = "audio"
	Text  = "texto"
)

// Default builds "<label> · DD/MM/YYYY HH:MM" in the local time zone.
func Default(label string, when time.Time) string {
	return fmt.Sprintf("%s · %s", label, when.In(time.Local).Format("02/01/2006 15:04"))
}
