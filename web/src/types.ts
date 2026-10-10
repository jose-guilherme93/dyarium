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
  emotions: Record<string, number> | null;
  people: string[] | null;
  places: string[] | null;
  summary: string;
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

export interface Settings {
  trim_silence: boolean;
  analyze_enabled: boolean;
  analyze_base_url: string;
  analyze_model: string;
  whisper_model: string;
}

export interface ServerEvent {
  id: number;
  name: string;
  data: Record<string, unknown>;
}
