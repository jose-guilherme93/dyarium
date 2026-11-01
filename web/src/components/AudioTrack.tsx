import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { api, attachmentUrl } from "../api";
import { formatDuration } from "../lib/format";
import { rememberAudioTime } from "../lib/noteViewState";
import { useEscape } from "../lib/useEscape";
import {
  CAPTURE_NOTEBOOK,
  CAPTURE_OPTIONS,
  markCaptured,
  readCaptures,
  saveTranscriptCapture,
  type CaptureKind,
} from "../lib/transcriptCapture";
import type { Audio, Segment } from "../types";
import { AudioPlayer, type AudioPlayerHandle } from "./AudioPlayer";
import {
  CheckIcon,
  CommentIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  SparkIcon,
} from "./icons";
import { Spinner } from "./Status";
import { useToast } from "./Toasts";

function CaptureIcon({ kind, size = 13 }: { kind: CaptureKind; size?: number }) {
  if (kind === "task") return <CheckIcon size={size} />;
  if (kind === "idea") return <SparkIcon size={size} />;
  return <CommentIcon size={size} />;
}

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
  // Index of the segment whose original text is revealed. So os trechos que a
  // revisao mudou oferecem a opcao, dentro do menu da linha.
  const [originalAt, setOriginalAt] = useState<number | null>(null);
  const [menuAt, setMenuAt] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ index: number; value: string } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captures, setCaptures] = useState<Record<string, CaptureKind>>(() =>
    entryId ? readCaptures(entryId) : {},
  );
  const [floatVisible, setFloatVisible] = useState(false);
  const { notify } = useToast();
  const lineRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const playerWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setCaptures(entryId ? readCaptures(entryId) : {});
  }, [entryId]);

  useEscape(menuAt !== null, () => setMenuAt(null));

  // O player rola para fora ao ler uma transcricao longa. Um botao fixo no
  // meio da tela devolve o play/pause sem obrigar a voltar ao topo.
  useEffect(() => {
    const target = playerWrapRef.current;
    if (!showFull || !target || typeof IntersectionObserver === "undefined") {
      setFloatVisible(false);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setFloatVisible(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [showFull]);

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

  const openMenu = (index: number) => {
    setEditing(null);
    setMenuAt((current) => (current === index ? null : index));
  };

  const startEdit = (index: number) => {
    const segment = segments[index];
    if (!segment) return;
    setMenuAt(null);
    setOriginalAt(null);
    setEditing({ index, value: segment.text });
  };

  const saveEdit = async () => {
    if (!editing || !entryId || savingEdit) return;
    const segment = segments[editing.index];
    const value = editing.value.trim();
    if (!segment || value === "") return;
    setSavingEdit(true);
    try {
      await api.updateTranscriptSegment(entryId, audio.id, segment.idx ?? editing.index, value);
      setSegments((current) =>
        current.map((item, index) =>
          index === editing.index
            ? { ...item, text: value, revised: undefined, edited: true }
            : item,
        ),
      );
      setEditing(null);
      notify("Trecho salvo", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível salvar o trecho", "error");
    } finally {
      setSavingEdit(false);
    }
  };

  const capture = async (kind: CaptureKind) => {
    if (menuAt === null || !entryId || capturing) return;
    const segment = segments[menuAt];
    if (!segment) return;
    setCapturing(true);
    try {
      const source = await api.getEntry(entryId).catch(() => null);
      await saveTranscriptCapture({
        sourceEntryId: entryId,
        sourceTitle: source?.title ?? "",
        segment,
        kind,
      });
      markCaptured(entryId, segment.start_ms, kind);
      setCaptures(readCaptures(entryId));
      setMenuAt(null);
      const label = CAPTURE_OPTIONS.find((option) => option.kind === kind)?.label ?? "Trecho";
      notify(`${label} guardada em ${CAPTURE_NOTEBOOK}`, "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível guardar esta captura", "error");
    } finally {
      setCapturing(false);
    }
  };

  return (
    <div className="audio-block">
      <div className="audio-player-wrap" ref={playerWrapRef}>
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
      </div>
      {showFull && floatVisible && (
        <span className="audio-play-slot">
          <button
            type="button"
            className="audio-play-float"
            aria-label={playing ? "Pausar" : "Reproduzir"}
            title={playing ? "Pausar" : "Reproduzir"}
            onClick={() => ref.current?.toggle()}
          >
            {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
          </button>
        </span>
      )}
      {hasTranscript && transcript && (
        <div className="audio-transcript">
          {showFull ? (
            <blockquote className="transcript">
              {segments.length > 0 ? (
                segments.map((segment, index) => {
                  const revised = segment.revised;
                  const open = originalAt === index;
                  const captureKind = captures[String(segment.start_ms)];
                  const menuOpen = menuAt === index;
                  const captureLabel = captureKind
                    ? CAPTURE_OPTIONS.find((option) => option.kind === captureKind)?.label
                    : "";
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
                      <span className="transcript-side">
                        {captureKind && (
                          <span
                            className={`transcript-capture transcript-capture--${captureKind}`}
                            title={`${captureLabel} · ${CAPTURE_NOTEBOOK}`}
                            aria-label={captureLabel}
                          >
                            <CaptureIcon kind={captureKind} />
                          </span>
                        )}
                        <button
                          type="button"
                          className="transcript-edit"
                          aria-label="Opções do trecho"
                          aria-haspopup="menu"
                          aria-expanded={menuOpen}
                          title="Editar ou transformar este trecho"
                          onClick={() => openMenu(index)}
                        >
                          <PencilIcon size={13} />
                        </button>
                      </span>

                      {menuOpen && (
                        <>
                          <button
                            type="button"
                            className="transcript-menu-backdrop"
                            aria-label="Fechar menu do trecho"
                            onClick={() => setMenuAt(null)}
                          />
                          <div className="transcript-menu" role="menu">
                            <button
                              type="button"
                              className="transcript-menu-item"
                              role="menuitem"
                              disabled={!entryId}
                              onClick={() => startEdit(index)}
                            >
                              <PencilIcon size={14} />
                              Editar trecho
                            </button>
                            <div className="transcript-menu-sep" />
                            {CAPTURE_OPTIONS.map((option) => (
                              <button
                                key={option.kind}
                                type="button"
                                className="transcript-menu-item"
                                role="menuitem"
                                disabled={capturing || !entryId}
                                onClick={() => void capture(option.kind)}
                              >
                                <CaptureIcon kind={option.kind} size={14} />
                                {option.label}
                              </button>
                            ))}
                            {revised && (
                              <>
                                <div className="transcript-menu-sep" />
                                <button
                                  type="button"
                                  className="transcript-menu-item"
                                  role="menuitem"
                                  aria-pressed={open}
                                  onClick={() => {
                                    setOriginalAt(open ? null : index);
                                    setMenuAt(null);
                                  }}
                                >
                                  <SparkIcon size={14} />
                                  {open ? "Ocultar texto original" : "Ver texto original"}
                                </button>
                              </>
                            )}
                          </div>
                        </>
                      )}

                      {open && revised && (
                        <p className="transcript-original">Original do whisper: {segment.text}</p>
                      )}

                      {editing !== null && editing.index === index && (
                        <div className="transcript-edit-box">
                          <textarea
                            autoFocus
                            value={editing.value}
                            aria-label="Editar trecho da transcrição"
                            onChange={(event) =>
                              setEditing({ index, value: event.target.value })
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                event.preventDefault();
                                setEditing(null);
                              }
                              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                                event.preventDefault();
                                void saveEdit();
                              }
                            }}
                          />
                          <div className="transcript-edit-actions">
                            <button
                              type="button"
                              className="button button--ghost button--small"
                              onClick={() => setEditing(null)}
                            >
                              Cancelar
                            </button>
                            <button
                              type="button"
                              className="button button--primary button--small"
                              onClick={() => void saveEdit()}
                              disabled={savingEdit || editing.value.trim() === ""}
                            >
                              {savingEdit ? <Spinner /> : null}
                              Salvar
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <p>
                  {loading ? (
                    <>
                      <Spinner /> Carregando transcrição…
                    </>
                  ) : (
                    `\u201c${text}\u201d`
                  )}
                </p>
              )}
              {cursor && (
                <button type="button" className="transcript-toggle" onClick={loadMore} disabled={loading}>
                  {loading ? <Spinner /> : null}
                  {loading ? "Carregando" : "Carregar mais"}
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
