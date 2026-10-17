export interface Entry {
  id: string;
  title: string;
  status: string;
  source: string;
  parent_id?: string | null;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  duration_seconds: number;
  sha256: string;
  recorded_at: string | null;
  created_at: string;
  updated_at: string;
  tags?: string[];
  metrics?: Metrics;
  audios?: Audio[];
}

export interface Audio {
  id: string;
  content_type: string;
  size_bytes: number;
  duration_seconds: number;
  created_at: string;
  transcript?: Transcript | null;
}

export interface Metrics {
  duration_ms: number;
  loudness_lufs: number;
  true_peak: number;
  silence_count: number;
  silence_total_ms: number;
  sample_rate: number;
  channels: number;
  whisper_peak_rss_mb: number;
}

export interface Segment {
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface Transcript {
  model: string;
  language: string;
  text: string;
  trim_silence: boolean;
  duration_seconds: number;
  segments: Segment[];
}

export interface Analysis {
  model: string;
  sentiment: number;
  sentiment_label: string;
  emotions: Record<string, number> | null;
  people: string[] | null;
  places: string[] | null;
  summary: string;
  emotions_detail?: AnalysisEmotion[] | null;
  people_detail?: AnalysisPerson[] | null;
  places_detail?: AnalysisPlace[] | null;
  themes?: AnalysisTheme[] | null;
  key_moments?: KeyMoment[] | null;
  questions?: string[] | null;
  decisions?: string[] | null;
}

export interface AnalysisEmotion {
  name: string;
  intensity: number;
}

export interface AnalysisPerson {
  name: string;
  count: number;
  relation: string;
  sentiment: number;
}

export interface AnalysisPlace {
  name: string;
  count: number;
}

export interface AnalysisTheme {
  name: string;
  confidence: number;
}

export interface KeyMoment {
  start_ms: number;
  text: string;
}

export type EntityKind = "person" | "place" | "theme";

export interface EntitySummary {
  kind: EntityKind;
  name: string;
  entries: number;
  mentions: number;
  sentiment: number;
  last_seen: string | null;
}

export interface EntityEntry {
  id: string;
  title: string;
  date: string | null;
  count: number;
}

export interface EntityDetail extends EntitySummary {
  entry_list: EntityEntry[];
}

export interface MoodPoint {
  date: string;
  sentiment: number;
  entries: number;
}

export interface Note {
  id: string;
  entry_id: string;
  title: string;
  /** Corpo em markdown (formato canonico). */
  content_markdown?: string;
  /** Versao do corpo: o cliente manda a que leu e o servidor recusa se mudou. */
  body_version?: string;
  /** Corpo em JSON do BlockNote: so em nota ainda nao convertida. */
  document?: unknown;
  created_at: string;
  updated_at: string;
}

export interface Revision {
  id: string;
  document: unknown;
  created_at: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  entry_count: number;
}

export interface Attachment {
  id: string;
  entry_id: string;
  kind: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
}

export interface Link {
  id: string;
  from_entry_id: string;
  to_entry_id: string;
  url: string;
  label: string;
  title: string;
  created_at: string;
}

export interface Settings {
  trim_silence: boolean;
  max_whisper_rss_mb: number;
  whisper_model: string;
  whisper_language: string;
  transcribe_provider: string;
  deepgram_model: string;
  deepgram_api_key_set: boolean;
  analyze_enabled: boolean;
  analyze_provider: string;
  analyze_base_url: string;
  analyze_model: string;
  analyze_api_key_set: boolean;
  analysis_themes: string;
}

export interface EntryProgress {
  status?: string;
  stage?: string;
  done?: number;
  total?: number;
  error?: string;
}

export interface ModelInfo {
  name: string;
  filename: string;
  size_mb: number;
  path: string;
  downloaded: boolean;
  local_bytes: number;
}

export interface ServerEvent {
  id: number;
  name: string;
  data: Record<string, unknown>;
}

/**
 * Metricas de escrita: o app calcula tudo offline e envia o documento pronto
 * (contrato versionado em docs/api.md). O painel so desenha o que recebe.
 */
export interface MetricsWordCount {
  label: string;
  value: number;
}

export interface MetricsSeriesPoint {
  label: string;
  words: number;
  notes: number;
}

export interface MetricsDayCell {
  key: string | null;
  words: number;
  notes: number;
}

export interface MetricsConsistencyDay {
  key: string;
  wrote: boolean;
  notes: number;
  words: number;
}

export interface MetricsSentiment {
  analyzed: number;
  average: number;
  positive: number;
  neutral: number;
  negative: number;
  top_positive: { title: string; score: number } | null;
  top_negative: { title: string; score: number } | null;
}

export interface MetricsWriting {
  notes: number;
  with_text: number;
  with_audio: number;
  with_transcript: number;
  words: number;
  chars: number;
  sentences: number;
  paragraphs: number;
  unique_words: number;
  lexical_richness: number;
  average_words_per_note: number;
  average_sentence_words: number;
  average_word_length: number;
  top_words: MetricsWordCount[];
  longest_words: MetricsWordCount[];
  questions: number;
  exclamations: number;
  links: number;
  images: number;
  list_items: number;
  transcript_words: number;
  average_transcript_words: number;
  active_days: number;
  average_notes_per_active_day: number;
  current_streak: number;
  longest_streak: number;
  wrote_today: boolean;
  top_weekday: MetricsWordCount | null;
  top_hour: MetricsWordCount | null;
  first_at: string | null;
  last_at: string | null;
  longest_note: { title: string; words: number } | null;
  monthly: MetricsSeriesPoint[];
  month_comparison_pct: number | null;
  sentiment: MetricsSentiment;
  weekday_hour: number[][];
  consistency: {
    days: MetricsConsistencyDay[];
    written_days: number;
    tracked_days: number;
    rate: number;
    longest_run: number;
  };
  insights: string[];
}

export interface MetricsHistory {
  weekly: MetricsSeriesPoint[];
  calendar: MetricsDayCell[][];
  max_weekly: number;
  max_daily: number;
}

export interface MetricsSnapshot {
  device_id: string;
  device_name: string;
  schema: number;
  generated_at: string;
  received_at: string;
  writing: MetricsWriting;
  history?: MetricsHistory;
}

export interface MetricsResponse {
  snapshots: MetricsSnapshot[];
  schema: number;
}
