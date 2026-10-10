-- Records the peak RSS observed for the whisper-cli subprocess, so the UI can
-- show how close a transcription got to the configured RAM ceiling.

ALTER TABLE audio_metrics ADD COLUMN whisper_peak_rss_mb INTEGER NOT NULL DEFAULT 0;
