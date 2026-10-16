package store

import "time"

// Entry statuses.
const (
	EntryReceived     = "received"
	EntryValidating   = "validating"
	EntryStored       = "stored"
	EntryQueued       = "queued"
	EntryTranscribing = "transcribing"
	EntryTranscribed  = "transcribed"
	EntryAnalyzing    = "analyzing"
	EntryEnriched     = "enriched"
	EntryReady        = "ready"
	EntryFailed       = "failed"
	EntryDeleted      = "deleted"
)

// Attachment kinds.
const (
	AttachmentOriginal   = "original"
	AttachmentDerived16k = "derived_16k"
)

// Upload is an in-progress resumable upload.
type Upload struct {
	ID          string
	Status      string
	Filename    string
	ContentType string
	SizeBytes   int64
	SHA256      string
	Title       string
	RecordedAt  *time.Time
	ClientKey   string
	// EntryID, when set, attaches the finished audio to an existing entry
	// instead of creating a new one.
	EntryID string
	// ResultAttachmentID is the audio attachment produced by Complete. Set on
	// completion so repeating Complete returns the same result (idempotent).
	ResultAttachmentID string
	// LocalTranscribe means the client will transcribe this audio on the device;
	// the server must not enqueue its own transcription.
	LocalTranscribe bool
	ReceivedBytes   int64
	StorageKey      string
	Prefix          []byte
	NextCounter     uint32
	CreatedAt       time.Time
	ExpiresAt       time.Time
}

// Entry is a stored audio and its lifecycle.
type Entry struct {
	ID     string
	Title  string
	Status string
	Source string
	// ParentID is the parent note in the tree; empty means it is at the root.
	ParentID         string
	OriginalFilename string
	ContentType      string
	SizeBytes        int64
	DurationSeconds  float64
	SHA256           string
	RecordedAt       *time.Time
	CreatedAt        time.Time
	UpdatedAt        time.Time
	DeletedAt        *time.Time
}

// Attachment is an encrypted object linked to an entry. Audio attachments use
// kind "original"; images use "image"; the derived 16 kHz working copy uses
// "derived_16k".
type Attachment struct {
	ID              string
	EntryID         string
	Kind            string
	StorageKey      string
	ContentType     string
	SizeBytes       int64
	SHA256          string
	Cipher          string
	CacheKey        string
	DurationSeconds float64
	CreatedAt       time.Time
}

// Transcript is a transcription of one audio attachment of an entry.
type Transcript struct {
	ID              string
	EntryID         string
	AttachmentID    string
	Model           string
	Language        string
	Text            string
	TrimSilence     bool
	DurationSeconds float64
	CreatedAt       time.Time
}

// Segment is a transcribed span mapped to the original audio timeline.
type Segment struct {
	ID           string
	TranscriptID string
	Idx          int
	StartMS      int64
	EndMS        int64
	Text         string
	CreatedAt    time.Time
}

// AudioMetrics holds ffmpeg/ffprobe measurements.
type AudioMetrics struct {
	EntryID          string
	DurationMS       int64
	LoudnessLUFS     float64
	TruePeak         float64
	SilenceCount     int
	SilenceTotalMS   int64
	SampleRate       int
	Channels         int
	WhisperPeakRSSMB int64
}

// Note is a free-form note attached to an entry (BlockNote JSON document).
type Note struct {
	ID        string
	EntryID   string
	Title     string
	Document  string
	CreatedAt time.Time
	UpdatedAt time.Time
}

// NoteRevision is a historical version of a note.
type NoteRevision struct {
	ID        string
	NoteID    string
	Document  string
	CreatedAt time.Time
}

// Tag is a label that can be attached to entries.
type Tag struct {
	ID         string
	Name       string
	Color      string
	EntryCount int
	CreatedAt  time.Time
}

// Link relates an entry to another entry or to an external URL. Exactly one of
// ToEntryID and URL is set. Title is the resolved title of the target entry
// when the link is internal, filled in on reads.
type Link struct {
	ID          string
	FromEntryID string
	ToEntryID   string
	URL         string
	Label       string
	Title       string
	CreatedAt   time.Time
}

// Analysis is the result of the optional text enrichment.
// Emotions, People and Places keep the legacy JSON shape (map/array of names)
// for backward compatibility; Data holds the full rich analysis.
type Analysis struct {
	ID             string
	EntryID        string
	Model          string
	Sentiment      float64
	SentimentLabel string
	Emotions       string
	People         string
	Places         string
	Summary        string
	Raw            string
	Data           string
	CreatedAt      time.Time
}

// Entity kinds.
const (
	EntityPerson = "person"
	EntityPlace  = "place"
	EntityTheme  = "theme"
)

// Entity is a normalized person, place or theme extracted from analyses.
type Entity struct {
	ID        string
	Kind      string
	Name      string
	CreatedAt time.Time
}

// EntityLink associates an entry with an entity and its per-entry metrics.
type EntityLink struct {
	Kind      string
	Name      string
	Count     int
	Relation  string
	Sentiment *float64
}

// EntitySummary aggregates one entity across entries.
type EntitySummary struct {
	Kind      string
	Name      string
	Entries   int
	Mentions  int
	Sentiment float64
	LastSeen  time.Time
}

// EntityEntry is an entry that mentions an entity.
type EntityEntry struct {
	EntryID string
	Title   string
	Date    time.Time
	Count   int
}

// MoodPoint is one day of the sentiment timeline.
type MoodPoint struct {
	Date      string
	Sentiment float64
	Entries   int
}
