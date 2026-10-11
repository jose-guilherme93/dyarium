export interface Entry {
  id: string;
  title: string;
  status: string;
  source: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  duration_seconds: number;
  sha256: string;
  recorded_at: string | null;
  created_at: string;
  updated_at: string;
  metrics?: Metrics;
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
  document: unknown;
  created_at: string;
  updated_at: string;
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
