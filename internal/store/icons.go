package store

// GraphIconKeys is the monochrome icon palette the map may draw inside a node.
// It is shared with the clients: the server only stores and validates the key,
// never the drawing. Keep in sync with web/src/lib/graphIcons.ts.
var GraphIconKeys = []string{
	"person",
	"home",
	"hash",
	"check",
	"heart",
	"star",
	"book",
	"briefcase",
	"music",
	"health",
	"money",
	"food",
	"car",
	"plane",
	"tree",
	"sun",
	"moon",
	"flag",
	"globe",
	"camera",
	"document",
}

var graphIconSet = func() map[string]bool {
	set := make(map[string]bool, len(GraphIconKeys))
	for _, key := range GraphIconKeys {
		set[key] = true
	}
	return set
}()

// ValidGraphIcon reports whether a key belongs to the icon palette. The empty
// string is not a key; callers use it to clear the custom icon.
func ValidGraphIcon(key string) bool {
	return graphIconSet[key]
}
