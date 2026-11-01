package store

import (
	"database/sql"
	"strings"
	"time"
)

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
	// EntryPurged is the tombstone of an entry whose content was already
	// destroyed. It must never be restored, but it still tells peers that the
	// deletion happened.
	EntryPurged = "purged"
)

// Attachment kinds.
const (
	AttachmentOriginal   = "original"
	AttachmentDerived16k = "derived_16k"
	AttachmentImage      = "image"
)

// Entry author roles. An empty Author means "follow the app default": the
// owner when AllNotesAreMine is on, no author when it is off. A note's explicit
// role always wins over the default.
const (
	AuthorSelf  = "self"
	AuthorOther = "other"
	AuthorMixed = "mixed"
)

// ValidAuthor reports whether value is one of the roles a note may store.
// Empty is valid and means "follow the default".
func ValidAuthor(value string) bool {
	switch value {
	case "", AuthorSelf, AuthorOther, AuthorMixed:
		return true
	default:
		return false
	}
}

// EffectiveAuthor resolves the author an analysis reads. The explicit role of
// the note wins; without one, the app default decides.
func EffectiveAuthor(explicit string, allNotesMine bool) string {
	if explicit = strings.TrimSpace(explicit); explicit != "" {
		return explicit
	}
	if allNotesMine {
		return AuthorSelf
	}
	return ""
}

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
	// LocalAnalysis means the client owns the analysis of this entry (it runs
	// on the device or is turned off), so the server must not enqueue analyze.
	LocalAnalysis bool
	// EntryCreatedAt is the original creation time of the note this audio will
	// create. It is immutable once the entry exists; nil means "use upload time".
	EntryCreatedAt *time.Time
	// EntrySource is the origin of the note (e.g. "share" for imported audio).
	EntrySource string
	// Author is the author role chosen on the device before the upload.
	Author        string
	ReceivedBytes int64
	StorageKey    string
	Prefix        []byte
	NextCounter   uint32
	CreatedAt     time.Time
	ExpiresAt     time.Time
}

// Quem criou um objeto. `Kind` e `device` (um aparelho com o app) ou `server`
// (o proprio ambiente, pelo dashboard ou pela API). Proveniencia apenas: nao
// muda permissao nem impede edicao em nenhum ambiente.
const (
	OriginKindDevice = "device"
	OriginKindServer = "server"
)

// Origin identifies who created an object. Empty means the row predates the
// field and the origin was not recorded.
type Origin struct {
	Instance string
	Kind     string
}

// Entry is a stored audio and its lifecycle.
type Entry struct {
	ID     string
	Title  string
	Status string
	Source string
	// OriginInstance and OriginKind record who created the entry. Set once on
	// creation; updates never touch them.
	OriginInstance string
	OriginKind     string
	// ParentID is the parent note in the tree; empty means it is at the root.
	ParentID string
	// NotebookID is the notebook that owns the note. Every note has one.
	NotebookID       string
	OriginalFilename string
	ContentType      string
	SizeBytes        int64
	DurationSeconds  float64
	SHA256           string
	RecordedAt       *time.Time
	CreatedAt        time.Time
	UpdatedAt        time.Time
	DeletedAt        *time.Time
	// Archived: a nota saiu da lista de trabalho, mas nao foi apagada.
	Archived bool
	// Author is the explicit role chosen for the note: self, other, mixed or
	// empty ("follow the app default").
	Author string
	// PrimaryAttachmentID is the first original audio of the entry. It lets the
	// list response point the app at the audio without fetching every stack.
	PrimaryAttachmentID string
	// TranscriptAt is when the entry's newest transcript was stored on the
	// server. Same role as AnalysisAt: the app fetches once per update.
	TranscriptAt string
	// AnalysisAt is when the entry's newest analysis was stored on the server.
	// It is the update signal the app uses to know when to fetch the analysis
	// once, instead of asking on every screen open.
	AnalysisAt string
	// Preview is the stored body of the entry, filled only by the list query.
	// The API turns it into plain text for the list.
	Preview string
	// SpokenPreview is the transcript text of the entry, filled only by the
	// list query. When the body has no prose (an app note whose body is just the
	// audio marker), the list shows the transcript instead.
	SpokenPreview string
	// Chapter fields. A chapter is an entry inside a book notebook; an empty
	// ChapterKind means the entry is a regular note. ChapterPosition orders the
	// flat chapter list and is never used by a notes notebook.
	ChapterKind      string
	ChapterPosition  *float64
	ChapterStatus    string
	ChapterGoalWords int
	ChapterSynopsis  string
	// ChapterBeats is the chapter plan: one beat per line, outside the prose.
	ChapterBeats string
	// ChapterNotes is the chapter research: free text, outside the prose.
	ChapterNotes string
	// WordCount is the prose word count, filled only when the caller asks for it
	// (the book list and the book home).
	WordCount int

	// Versoes dos campos editaveis, como o cliente leu (so preenchidas nas
	// leituras que as trazem). Sao os valores **exatos** gravados no banco: o
	// cliente manda a mesma string de volta, e o servidor compara. Reformatar
	// aqui (por exemplo, perdendo nanossegundos) faria toda gravacao following
	// parecer conflito com ela mesma.
	TitleUpdatedAt    string
	RecordedAtVersion string
	BodyVersion       string
}

// setVersions preenche as versoes dos campos editaveis de uma entrada escaneada.
// As colunas vao no fim da lista: `title_updated_at`, `recorded_at_updated_at` e
// a versao do corpo (que vem de uma subconsulta em `notes`, porque nem toda
// entrada tem nota).
func setVersions(e *Entry, titleVersion, recordedVersion, bodyVersion sql.NullString) {
	e.TitleUpdatedAt = titleVersion.String
	e.RecordedAtVersion = recordedVersion.String
	e.BodyVersion = bodyVersion.String
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
	// RevisedText is the joined AI revision of the segments. Empty when the
	// transcript was never revised; Text keeps the raw whisper output.
	RevisedText          string
	RevisedModel         string
	RevisedPromptVersion int
	RevisedLiteral       bool
	// RevisedComprehension is the revision pass estimate (0-100) kept with the
	// derived text; -1 when absent. Re-analysing a current revision reuses it.
	RevisedComprehension int
	// RevisedRejected counts segments the revision pass could not use: the model
	// answered in an unusable shape, the window failed, or the acceptance
	// guardrails refused it. Zero means "every segment was reviewed"; a segment
	// that came back identical is reviewed, not rejected.
	RevisedRejected int
	// RevisedThrough is the index of the first segment the pass did not reach.
	// Zero means "nothing reached yet"; SegmentCount means "the whole
	// transcript". It tells an interrupted pass from one that finished with
	// rejections.
	RevisedThrough int
	// RevisedFinished is true when the pass reached the end of the transcript,
	// even if some segments were rejected.
	RevisedFinished bool
	// SegmentCount is how many segments the transcript has. It is read with the
	// row so the summary can report pending segments without loading them.
	SegmentCount int
	// RevisedChanged counts segments whose revision differs from the original.
	// Computed with the row for the same reason.
	RevisedChanged int
	// RevisedPending counts non-edited segments the pass did not reach.
	RevisedPending int
	CreatedAt      time.Time
}

// Segment is a transcribed span mapped to the original audio timeline.
type Segment struct {
	ID           string
	TranscriptID string
	Idx          int
	StartMS      int64
	EndMS        int64
	Text         string
	// Revised is the AI revision of this segment. Empty when the segment was
	// not revised (revision off, window rejected, or user-edited text).
	Revised string
	// UserEdited marks a segment written by the user. The revision never
	// touches it and a new sync keeps the flag.
	UserEdited bool
	CreatedAt  time.Time
}

// TranscriptRevision is the AI revision of one segment. It never replaces the
// original: the reader shows Revised by default and the panel reveals Text.
type TranscriptRevision struct {
	SegmentID     string
	Text          string
	Model         string
	PromptVersion int
	Literal       bool
	CreatedAt     time.Time
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

// Note is a free-form note attached to an entry. Content is markdown (the format
// the app and the dashboard both speak); Document is the legacy BlockNote JSON,
// kept only while old notes are being converted.
type Note struct {
	ID       string
	EntryID  string
	Title    string
	Document string
	// ContentMarkdown is the note body in markdown.
	ContentMarkdown string
	// BodyVersion is the version of the body: it changes on every accepted
	// write and is what a client compares against to detect a real conflict.
	// Opaque token issued by the hybrid logical clock, not a timestamp.
	BodyVersion string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// NoteRevision is a historical version of a note.
type NoteRevision struct {
	ID        string
	NoteID    string
	Document  string
	CreatedAt time.Time
}

// Notebook kinds. A notebook is either a regular collection of notes or a
// book: its entries are chapters and the dashboard opens the writer workspace.
const (
	NotebookKindNotes = "notes"
	NotebookKindBook  = "book"
)

// Book statuses.
const (
	BookDrafting = "drafting"
	BookRevising = "revising"
	BookDone     = "done"
)

// Chapter kinds. A book keeps a flat list; a part is a divider in the same list.
const (
	ChapterKindChapter = "chapter"
	ChapterKindPart    = "part"
	ChapterKindFront   = "front"
	ChapterKindBack    = "back"
)

// Chapter statuses. Empty means "not a chapter"; the book interface maps the
// three values to draft, revising and done marks.
const (
	ChapterDraft    = "draft"
	ChapterRevising = "revising"
	ChapterDone     = "done"
)

// ValidNotebookKind reports whether kind is a known notebook kind.
func ValidNotebookKind(kind string) bool {
	return kind == NotebookKindNotes || kind == NotebookKindBook
}

// ValidBookStatus reports whether status is a known book status.
func ValidBookStatus(status string) bool {
	switch status {
	case BookDrafting, BookRevising, BookDone:
		return true
	default:
		return false
	}
}

// ValidChapterKind reports whether kind is a chapter kind a book accepts.
func ValidChapterKind(kind string) bool {
	switch kind {
	case ChapterKindChapter, ChapterKindPart, ChapterKindFront, ChapterKindBack:
		return true
	default:
		return false
	}
}

// ValidChapterStatus reports whether status is a known chapter status.
func ValidChapterStatus(status string) bool {
	switch status {
	case "", ChapterDraft, ChapterRevising, ChapterDone:
		return true
	default:
		return false
	}
}

// Notebook is a collection of entries. Every entry belongs to exactly one.
// A notebook with Kind "book" is a book and its entries are chapters.
type Notebook struct {
	ID         string
	Name       string
	Color      string
	IsDefault  bool
	Kind       string
	Subtitle   string
	Author     string
	Synopsis   string
	Language   string
	GoalWords  int
	BookStatus string
	// Page geometry of the book: the editor sheet, the reading preview, the
	// PDF and the DOCX all use the same measure.
	PageSize       string
	PageMarginMM   int
	BodyPX         int
	BodyLeading    int
	BodyFont       string
	DailyGoalWords int
	Deadline       string
	HasCover       bool
	CoverUpdatedAt *time.Time
	EntryCount     int
	ChapterCount   int
	Words          int
	LastEntryAt    *time.Time
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// IsBook reports whether the notebook is a book.
func (n Notebook) IsBook() bool { return n.Kind == NotebookKindBook }

// BookCover is the cropped cover image of a book. One per notebook; the list of
// notebooks only carries whether it exists and when it changed.
type BookCover struct {
	NotebookID  string
	ContentType string
	Image       []byte
	UpdatedAt   time.Time
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
	// Comprehension is the 0-100 estimate of how well the raw transcript
	// represents the speech. -1 means it was not measured.
	Comprehension       int
	ComprehensionSource string
	// Rates are per 100 words of the raw audio text.
	StutterRate     float64
	HesitationRate  float64
	RevisedSegments int
	// Origin is who produced the analysis: "app", "server", "browser" or "api".
	Origin string
	// Device identifies where a browser analysis ran. Anonymous id plus a
	// short label (browser, system, GPU); empty for server and app rows.
	DeviceID   string
	DeviceName string
	CreatedAt  time.Time
}

// Entity kinds.
const (
	EntityPerson   = "person"
	EntityPlace    = "place"
	EntityTheme    = "theme"
	EntityDecision = "decision"
)

// ValidEntityKind reports whether kind is an entity the map and the entity
// endpoints understand.
func ValidEntityKind(kind string) bool {
	switch kind {
	case EntityPerson, EntityPlace, EntityTheme, EntityDecision:
		return true
	default:
		return false
	}
}

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
	ID        string
	Kind      string
	Name      string
	Icon      string
	Entries   int
	Mentions  int
	Sentiment float64
	LastSeen  time.Time
	// UpdatedAt e o relogio do servidor para o nome, o icone e o "sou eu".
	// O app compara com a propria copia para decidir qual escrita vence.
	UpdatedAt time.Time
	// Aliases sao as grafias antigas que ainda resolvem para esta entidade.
	Aliases []string
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
