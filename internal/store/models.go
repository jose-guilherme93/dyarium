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
	ID            string
	Status        string
	Filename      string
	ContentType   string
	SizeBytes     int64
	SHA256        string
	ReceivedBytes int64
	StorageKey    string
	Prefix        []byte
	NextCounter   uint32
	CreatedAt     time.Time
	ExpiresAt     time.Time
}

// Entry is a stored audio and its lifecycle.
type Entry struct {
	ID               string
	Title            string
	Status           string
	Source           string
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

// Attachment is an encrypted object linked to an entry.
type Attachment struct {
	ID          string
	EntryID     string
	Kind        string
	StorageKey  string
	ContentType string
	SizeBytes   int64
	SHA256      string
	Cipher      string
	CacheKey    string
	CreatedAt   time.Time
}

// Transcript is a transcription of an entry.
type Transcript struct {
	ID              string
	EntryID         string
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
	EntryID        string
	DurationMS     int64
	LoudnessLUFS   float64
	TruePeak       float64
	SilenceCount   int
	SilenceTotalMS int64
	SampleRate     int
	Channels       int
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

// Analysis is the result of the optional text enrichment.
type Analysis struct {
	ID        string
	EntryID   string
	Model     string
	Sentiment float64
	Emotions  string
	People    string
	Places    string
	Summary   string
	Raw       string
	CreatedAt time.Time
}
