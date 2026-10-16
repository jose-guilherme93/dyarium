import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { attachmentUrl } from "../api";
import { formatDuration } from "../lib/format";
import type { Audio } from "../types";
import { AudioPlayer, type AudioPlayerHandle } from "./AudioPlayer";

interface AudioTrackProps {
  audio: Audio;
  // playerRef lets the parent seek the first audio (for example, from the AI
  // key moments).
  playerRef?: RefObject<AudioPlayerHandle | null>;
}

// AudioTrack renders one audio of a note with its own player and a compact
// transcript preview (about four lines) that can be expanded on demand, so a
// long transcription does not stretch the note.
export function AudioTrack({ audio, playerRef }: AudioTrackProps) {
  const localRef = useRef<AudioPlayerHandle | null>(null);
  const ref = playerRef ?? localRef;
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const lineRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const transcript = audio.transcript ?? null;
  const hasTranscript = !!transcript && (transcript.text.trim() !== "" || transcript.segments.length > 0);
  const previewText = transcript
    ? transcript.text.trim() || transcript.segments.map((segment) => segment.text).join(" ")
    : "";

  let activeSegment = -1;
  if (currentTime > 0 && transcript && transcript.segments.length > 0) {
    for (let i = 0; i < transcript.segments.length; i++) {
      if (transcript.segments[i].start_ms <= currentTime * 1000) {
        activeSegment = i;
      } else {
        break;
      }
    }
  }

  // Keep the active transcription line visible while the audio plays.
  useEffect(() => {
    if (!showFull || !playing || !transcript || transcript.segments.length === 0 || activeSegment < 0) {
      return;
    }
    lineRefs.current[activeSegment]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [showFull, playing, activeSegment, transcript]);

  return (
    <div className="audio-block">
      <AudioPlayer ref={ref} src={attachmentUrl(audio.id)} onTime={setCurrentTime} onPlaying={setPlaying} />
      {hasTranscript && transcript && (
        <div className="audio-transcript">
          {showFull || transcript.segments.length === 0 ? (
            <blockquote className="transcript">
              {transcript.segments.length > 0 ? (
                transcript.segments.map((segment, index) => (
                  <p key={index}>
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
                <p>{transcript.text}</p>
              )}
            </blockquote>
          ) : (
            <blockquote className="transcript transcript--clamped">
              <p>{previewText}</p>
            </blockquote>
          )}
          {transcript.segments.length > 0 && (
            <button type="button" className="transcript-toggle" onClick={() => setShowFull((value) => !value)}>
              {showFull ? "Ocultar transcricao" : "Mostrar transcricao"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default AudioTrack;
