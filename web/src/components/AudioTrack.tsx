import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { api, attachmentUrl } from "../api";
import { formatDuration } from "../lib/format";
import { rememberAudioTime } from "../lib/noteViewState";
import type { Audio, Segment } from "../types";
import { AudioPlayer, type AudioPlayerHandle } from "./AudioPlayer";

interface AudioTrackProps {
  audio: Audio;
  // playerRef lets the parent seek the first audio (for example, from the AI
  // key moments).
  playerRef?: RefObject<AudioPlayerHandle | null>;
  /** Entry id, needed to page the transcript segments on demand. */
  entryId?: string;
  /** Whether the transcript was expanded on the previous visit. */
  initialExpanded?: boolean;
  /** Persists the expanded state when the user toggles it. */
  onExpandedChange?: (expanded: boolean) => void;
  /** Playback position restored from the previous visit (seconds). */
  initialTime?: number;
}

// AudioTrack renders one audio of a note with its own player and a compact
// transcript preview (about four lines) that can be expanded on demand, so a
// long transcription does not stretch the note. The entry payload only carries
// the transcript text; segments are fetched page by page when expanded.
export function AudioTrack({
  audio,
  playerRef,
  entryId,
  initialExpanded = false,
  onExpandedChange,
  initialTime = 0,
}: AudioTrackProps) {
  const localRef = useRef<AudioPlayerHandle | null>(null);
  const ref = playerRef ?? localRef;
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showFull, setShowFull] = useState(initialExpanded);
  const [segments, setSegments] = useState<Segment[]>(audio.transcript?.segments ?? []);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const lineRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const transcript = audio.transcript ?? null;
  const text = transcript?.text.trim() ?? "";
  const hasTranscript = text !== "" || segments.length > 0;

  let activeSegment = -1;
  if (currentTime > 0) {
    for (let i = 0; i < segments.length; i++) {
      if (segments[i].start_ms <= currentTime * 1000) {
        activeSegment = i;
      } else {
        break;
      }
    }
  }

  // Load the first page of segments the first time the transcript expands.
  useEffect(() => {
    if (!showFull || !entryId || segments.length > 0 || text === "" || loading) {
      return;
    }
    let active = true;
    setLoading(true);
    api
      .listSegments(entryId, audio.id)
      .then((page) => {
        if (!active) return;
        setSegments(page.segments ?? []);
        setCursor(page.next_cursor);
      })
      .catch(() => {
        // Segments are optional: keep the plain transcript text.
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [showFull, entryId, audio.id, segments.length, text]);

  const loadMore = () => {
    if (!entryId || !cursor || loading) return;
    setLoading(true);
    api
      .listSegments(entryId, audio.id, cursor)
      .then((page) => {
        setSegments((current) => [...current, ...(page.segments ?? [])]);
        setCursor(page.next_cursor);
      })
      .catch(() => {
        // keep what is already on screen
      })
      .finally(() => setLoading(false));
  };

  // Keep the active transcription line visible while the audio plays.
  useEffect(() => {
    if (!showFull || !playing || segments.length === 0 || activeSegment < 0) {
      return;
    }
    lineRefs.current[activeSegment]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [showFull, playing, activeSegment, segments.length]);

  return (
    <div className="audio-block">
      <AudioPlayer
        ref={ref}
        src={attachmentUrl(audio.id)}
        initialTime={initialTime}
        onTime={(seconds) => {
          setCurrentTime(seconds);
          if (entryId) {
            rememberAudioTime(entryId, audio.id, seconds);
          }
        }}
        onPlaying={setPlaying}
      />
      {hasTranscript && transcript && (
        <div className="audio-transcript">
          {showFull ? (
            <blockquote className="transcript">
              {segments.length > 0 ? (
                segments.map((segment, index) => (
                  <p key={`${segment.start_ms}-${index}`}>
                    <button
                      ref={(el) => {
                        lineRefs.current[index] = el;
                      }}
                      type="button"
                      className={index === activeSegment ? "transcript-line transcript-line--active" : "transcript-line"}
                      onClick={() => ref.current?.seek(segment.start_ms / 1000)}
                      title="Ouvir a partir daqui"
                    >
                      <span className="timestamp">{formatDuration(segment.start_ms / 1000)}</span>
                      {segment.text}
                    </button>
                  </p>
                ))
              ) : (
                <p>{loading ? "Carregando transcrição..." : text}</p>
              )}
              {cursor && (
                <button type="button" className="transcript-toggle" onClick={loadMore} disabled={loading}>
                  {loading ? "Carregando..." : "Carregar mais"}
                </button>
              )}
            </blockquote>
          ) : (
            <blockquote className="transcript transcript--clamped">
              <p>{text}</p>
            </blockquote>
          )}
          {(text !== "" || segments.length > 0) && (
            <button
              type="button"
              className="transcript-toggle"
              onClick={() => {
                setShowFull((value) => {
                  onExpandedChange?.(!value);
                  return !value;
                });
              }}
            >
              {showFull ? "Ocultar transcrição" : "Mostrar transcrição"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default AudioTrack;
