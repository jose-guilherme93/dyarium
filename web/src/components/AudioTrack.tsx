import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { api, attachmentUrl } from "../api";
import { formatDuration } from "../lib/format";
import { rememberAudioTime } from "../lib/noteViewState";
import type { Audio, Segment } from "../types";
import { AudioPlayer, type AudioPlayerHandle } from "./AudioPlayer";
import { ReviewChip } from "./ReviewChip";
import { SparkIcon } from "./icons";

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
  /** Removes this audio from the note and from the server. */
  onDelete?: () => void;
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
  onDelete,
}: AudioTrackProps) {
  const localRef = useRef<AudioPlayerHandle | null>(null);
  const ref = playerRef ?? localRef;
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showFull, setShowFull] = useState(initialExpanded);
  const [segments, setSegments] = useState<Segment[]>(audio.transcript?.segments ?? []);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  // O texto da transcricao muda janela a janela enquanto a IA revisa. Com o
  // painel aberto, os segmentos precisam ser relidos; sem isso a revisao so
  // aparecia depois de recarregar a pagina.
  const transcriptTextRef = useRef(audio.transcript?.text ?? "");
  // Index of the segment whose original text is revealed. Only segments the
  // revision actually changed carry the icon.
  const [originalAt, setOriginalAt] = useState<number | null>(null);
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

  // Revisao chegou com o painel aberto: relê a primeira pagina de segmentos
  // (o texto visivel mudou) para o antes/depois e o chip acompanharem.
  useEffect(() => {
    const current = transcript?.text ?? "";
    if (!showFull || !entryId || segments.length === 0 || transcriptTextRef.current === current) {
      transcriptTextRef.current = current;
      return;
    }
    transcriptTextRef.current = current;
    let active = true;
    setLoading(true);
    setOriginalAt(null);
    api
      .listSegments(entryId, audio.id)
      .then((page) => {
        if (!active) return;
        setSegments(page.segments ?? []);
        setCursor(page.next_cursor);
      })
      .catch(() => {
        // mantem os segmentos que ja estavam na tela
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [transcript?.text, showFull, entryId, audio.id, segments.length]);

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
        onDelete={onDelete}
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
          {showFull && segments.length > 0 && (
            <ReviewChip transcript={transcript} segments={segments} />
          )}
          {showFull ? (
            <blockquote className="transcript">
              {segments.length > 0 ? (
                segments.map((segment, index) => {
                  const revised = segment.revised;
                  const open = originalAt === index;
                  return (
                    <div key={`${segment.start_ms}-${index}`} className="transcript-row">
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
                        {index === 0 ? "\u201c" : ""}
                        {(segment.revised ?? segment.text).replace(/\s+/g, " ").trim()}
                        {index === segments.length - 1 && !cursor ? "\u201d" : ""}
                      </button>
                      {revised && (
                        <button
                          type="button"
                          className="transcript-original-toggle"
                          aria-label="Ver o texto original do whisper"
                          aria-expanded={open}
                          title={open ? "Ocultar o texto original" : "Melhorado por IA: ver o texto original"}
                          onClick={() => setOriginalAt(open ? null : index)}
                        >
                          <SparkIcon size={13} />
                        </button>
                      )}
                      {open && revised && (
                        <p className="transcript-original">Original do whisper: {segment.text}</p>
                      )}
                    </div>
                  );
                })
              ) : (
                <p>{loading ? "Carregando transcrição..." : `\u201c${text}\u201d`}</p>
              )}
              {cursor && (
                <button type="button" className="transcript-toggle" onClick={loadMore} disabled={loading}>
                  {loading ? "Carregando..." : "Carregar mais"}
                </button>
              )}
            </blockquote>
          ) : (
            <blockquote className="transcript transcript--clamped">
              <p>{`\u201c${text}\u201d`}</p>
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
