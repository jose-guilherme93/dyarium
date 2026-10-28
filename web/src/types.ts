export interface Entry {
  id: string;
  title: string;
  status: string;
  source: string;
  parent_id?: string | null;
  /** Caderno que possui a nota. */
  notebook_id?: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  duration_seconds: number;
  sha256: string;
  recorded_at: string | null;
  created_at: string;
  updated_at: string;
  tags?: string[];
  /** Primeiras linhas do corpo ou da transcrição, ja em prosa. */
  preview?: string;
  metrics?: Metrics;
  audios?: Audio[];
  /** Versao de cada campo editavel (so no detalhe da entrada). */
  versions?: EntryVersions;
  /** Nota arquivada: sai da lista de trabalho sem ser apagada. */
  archived?: boolean;
  /**
   * Papel do autor: "" segue o padrao do app, self/other/mixed e escolha
   * explicita da nota. O autor efetivo depende de all_notes_mine.
   */
  author?: AuthorRole;
  /** Quando a nota foi apagada (so na listagem da lixeira, `?deleted=1`). */
  deleted_at?: string | null;
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
  /** Position in the transcript; the key the revision is applied to. */
  idx?: number;
  start_ms: number;
  end_ms: number;
  /** Original text from whisper. Never overwritten by the revision. */
  text: string;
  /** AI revision of this segment, present only when it differs from text. */
  revised?: string;
  /** Segment written by the user; the revision never touches it. */
  edited?: boolean;
  /** A passada de revisao chegou neste trecho, mesmo sem mudar o texto. */
  reviewed?: boolean;
}

export interface Transcript {
  model: string;
  language: string;
  /** The text the user reads: the revision when it exists, the raw one otherwise. */
  text: string;
  /** Texto cru do whisper, preservado mesmo quando ha revisao. */
  raw_text?: string;
  trim_silence: boolean;
  duration_seconds: number;
  /** Whether this transcript already has an AI revision. */
  revised?: boolean;
  /** Modelo que revisou; vazio quando nunca revisou. */
  revised_model?: string;
  /** Estimativa 0-100 da compreensao logica; -1 quando ausente. */
  revised_comprehension?: number;
  /** Trechos que ficaram sem revisao (resposta recusada ou janela perdida). */
  revised_rejected?: number;
  /** Trechos alterados pela revisao, contados no servidor. */
  revised_changed?: number;
  /** Trechos que a passada ainda nao alcancou; 0 quando terminou. */
  revised_pending?: number;
  /** Indice do primeiro trecho que a passada ainda nao alcancou. */
  revised_through?: number;
  /** A passada chegou ao fim (mesmo com recusas no caminho). */
  revised_finished?: boolean;
  /** Ausente no payload da entrada; carregado sob demanda ao expandir. */
  segments?: Segment[];
}

export interface Analysis {
  /** Quem produziu: análise feita no aparelho, neste servidor ou em uma API. */
  origin?: "app" | "server" | "api";
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
  /** Análise de verdade: o que o texto diz, o que revela, o que fica em aberto. */
  reading?: string | null;
  /** Análise seção por seção (títulos do texto escrito e a transcrição). */
  sections?: AnalysisSection[] | null;
  key_moments?: KeyMoment[] | null;
  questions?: string[] | null;
  decisions?: string[] | null;
  /** 0-100 estimate of how well the transcript represents the speech; -1 when absent. */
  comprehension?: number;
  /** "review" when the revision pass measured it, "analysis" for the model estimate. */
  comprehension_source?: string;
  /** Disfluency series per 100 words of the raw audio text. */
  stutter_rate?: number;
  hesitation_rate?: number;
  /** How many segments the revision actually changed. */
  revised_segments?: number;
}

export interface AnalysisSection {
  heading: string;
  /** "text" para uma seção escrita, "transcript" para a fala. */
  kind: string;
  reading: string;
  summary: string;
  sentiment: { score: number; label: string };
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

export type EntityKind = "person" | "place" | "theme" | "decision";

/** Papel do autor de uma nota. Vazio segue o padrao do app. */
export type AuthorRole = "" | "self" | "other" | "mixed";

export interface GraphNode {
  id: string;
  kind: "user" | EntityKind | "note";
  label: string;
  /** Icone monocromatico escolhido pelo dono; vazio usa o do tipo. */
  icon?: string;
  mentions: number;
  notes: number;
  sentiment?: number;
  last_seen?: string | null;
  /** So nos de nota (modo foco). */
  date?: string | null;
  author?: AuthorRole;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: "relation" | "cooccurrence" | "mention";
  weight: number;
}

export interface GraphResponse {
  center: GraphNode;
  nodes: GraphNode[];
  edges: GraphEdge[];
  total_nodes: number;
  total_edges: number;
  truncated: boolean;
}

export interface EntitySummary {
  id?: string;
  kind: EntityKind;
  name: string;
  icon?: string;
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

/** Um processo que terminou numa nota (transcricao ou analise). */
export interface Activity {
  id: string;
  entry_id: string;
  /** "transcription" ou "analysis". */
  kind: string;
  title: string;
  finished_at: string;
}

export interface EntryVersions {
  title?: string;
  recorded_at?: string;
  body?: string;
}

export interface Note {
  id: string;
  entry_id: string;
  title: string;
  /** Corpo em markdown (formato canonico). */
  content_markdown?: string;
  /** Versao do corpo: o cliente manda a que leu e o servidor recusa se mudou. */
  body_version?: string;
  /** Corpo em JSON do BlockNote: so em nota ainda não convertida. */
  document?: unknown;
  created_at: string;
  updated_at: string;
}

export interface Revision {
  id: string;
  /** Corpo anterior em markdown (a coluna no servidor se chama `document` por heranca). */
  content_markdown: string;
  created_at: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  entry_count: number;
}

export interface Notebook {
  id: string;
  name: string;
  color: string;
  is_default: boolean;
  entry_count: number;
  last_entry_at?: string;
  created_at: string;
  updated_at: string;
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
  /** Nome do dono do diario; vazio mostra "Voce". */
  owner_name: string;
  /** Todas as notas sao do dono por padrao. Desligado, nota sem escolha nao tem autor. */
  all_notes_mine: boolean;
  trim_silence: boolean;
  max_whisper_rss_mb: number;
  whisper_model: string;
  whisper_language: string;
  transcribe_provider: string;
  deepgram_model: string;
  deepgram_api_key_set: boolean;
  analyze_enabled: boolean;
  analyze_provider: string;
  /** "ollama", "embedded" ou vazio (provedor externo). */
  analyze_local_runtime: string;
  analyze_base_url: string;
  analyze_model: string;
  analyze_api_key_set: boolean;
  analysis_themes: string;
  /** Revise the transcript with the same model before analysing it. */
  review_enabled: boolean;
  /** Keep hesitations and stutters in the revised text. */
  literal_transcript: boolean;
}

export interface EntryProgress {
  status?: string;
  stage?: string;
  done?: number;
  total?: number;
  error?: string;
}

/** Download de modelo local em andamento (ou o último), para o painel acompanhar. */
export interface LocalAnalysisPull {
  model: string;
  percent: number;
  done: boolean;
  error?: string;
}

/** Estado de um runtime local: Ollama no serviço ou llama.cpp embutido. */
export interface LocalAnalysis {
  runtime: "ollama" | "embedded";
  available: boolean;
  base_url: string;
  models: string[];
  model: string;
  /** No runtime embutido: o GGUF está no disco. */
  downloaded?: boolean;
  /** No runtime embutido: o llama-server está rodando agora. */
  running?: boolean;
  size_mb?: number;
  pull?: LocalAnalysisPull;
}

/** Resultado do "usar análise local" em um clique. */
export interface LocalAnalysisSetup {
  runtime: "ollama" | "embedded";
  status: "ready" | "downloading";
  model: string;
  base_url: string;
  installed: boolean;
  size_mb?: number;
}

export interface ModelInfo {  name: string;
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
 * Métricas de escrita: o app calcula tudo offline e envia o documento pronto
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

export interface MetricsConsistency {
  days: MetricsConsistencyDay[];
  written_days: number;
  tracked_days: number;
  rate: number;
  longest_run: number;
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
  consistency: MetricsConsistency;
  insights: string[];
}

export interface MetricsHistory {
  weekly: MetricsSeriesPoint[];
  calendar: MetricsDayCell[][];
  max_weekly: number;
  max_daily: number;
}

export interface MetricsSnapshotV1 {
  device_id: string;
  device_name: string;
  schema: 1;
  generated_at: string;
  received_at: string;
  writing: MetricsWriting;
  history?: MetricsHistory;
}

export type MetricsTone = "positive" | "neutral" | "negative";

export interface MetricsEmotion {
  label: string;
  count: number;
  tone: MetricsTone;
}

/** Escrita dentro de uma janela (schema 2). */
export interface MetricsWindowWriting {
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
  reading_minutes: number;
  top_words: MetricsWordCount[];
  longest_words: MetricsWordCount[];
  questions: number;
  exclamations: number;
  links: number;
  images: number;
  list_items: number;
  active_days: number;
  average_notes_per_active_day: number;
  notes_per_week: number;
  top_weekday: MetricsWordCount | null;
  top_hour: MetricsWordCount | null;
  weekday_hour: number[][];
  consistency: MetricsConsistency;
  longest_note: { title: string; words: number } | null;
}

export interface MetricsVoice {
  audio_count: number;
  audio_minutes: number;
  transcribed_minutes: number;
  coverage: number;
  words: number;
  words_per_minute: number;
  words_per_audio: number;
  origin_local: number;
  origin_server: number;
  transcript_share: number;
}

export interface MetricsImages {
  count: number;
  bytes_total: number;
  bytes_average: number;
  per_note: number;
  notes_with_image: number;
  notes_with_image_no_text: number;
}

export interface MetricsAnalysis {
  notes_with_content: number;
  notes_analyzed: number;
  coverage: number;
  stale: number;
  simplified: number;
  last_analyzed_at: string | null;
}

export interface MetricsRankedCount {
  label: string;
  count: number;
}

export interface MetricsTopics {
  themes: MetricsRankedCount[];
  people: MetricsRankedCount[];
  places: MetricsRankedCount[];
}

export interface MetricsSentimentV2 {
  source: "analysis" | "lexical";
  analyzed: number;
  positive: number;
  neutral: number;
  negative: number;
  average: number;
  top_positive: { title: string; score: number } | null;
  top_negative: { title: string; score: number } | null;
  emotions: MetricsEmotion[];
  series: { key: string; average: number; notes: number }[];
  granularity: "day" | "week";
}

export interface MetricsWindow {
  from: string;
  to: string;
  writing: MetricsWindowWriting;
  voice: MetricsVoice;
  images: MetricsImages;
  analysis: MetricsAnalysis;
  sentiment: MetricsSentimentV2;
  topics: MetricsTopics;
  summary: string[];
}

export interface MetricsStreak {
  current: number;
  longest: number;
  wrote_today: boolean;
}

export interface MetricsSnapshotV2 {
  device_id: string;
  device_name: string;
  schema: 2;
  generated_at: string;
  received_at: string;
  streak: MetricsStreak;
  windows: Record<"7d" | "30d" | "365d", MetricsWindow>;
  history?: MetricsHistory;
}

export type MetricsSnapshot = MetricsSnapshotV1 | MetricsSnapshotV2;

export interface MetricsResponse {
  snapshots: MetricsSnapshot[];
  schema: number;
}
