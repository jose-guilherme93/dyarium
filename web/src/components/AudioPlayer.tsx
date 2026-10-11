import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { formatDuration } from "../lib/format";
import { CheckIcon, MoreIcon, PauseIcon, PlayIcon } from "./icons";

interface AudioPlayerProps {
  src: string;
  /** Reports the current playback position (seconds). */
  onTime?: (seconds: number) => void;
  /** Reports whether the audio is currently playing. */
  onPlaying?: (playing: boolean) => void;
}

export interface AudioPlayerHandle {
  seek: (seconds: number) => void;
}

const RATES = [0.75, 1, 1.25, 1.5, 2];

// AudioPlayer is a compact player for a note's original audio.
export const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(function AudioPlayer(
  { src, onTime, onPlaying }: AudioPlayerProps,
  handle,
) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [rate, setRate] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    setRate(1);
    setMenuOpen(false);
  }, [src]);

  const toggle = () => {
    const el = ref.current;
    if (!el) {
      return;
    }
    if (el.paused) {
      void el.play();
    } else {
      el.pause();
    }
  };

  const setPlayingState = (value: boolean) => {
    setPlaying(value);
    onPlaying?.(value);
  };

  const seek = (value: number) => {
    const el = ref.current;
    if (el) {
      el.currentTime = value;
    }
    setCurrent(value);
    onTime?.(value);
  };

  const changeRate = (value: number) => {
    setRate(value);
    if (ref.current) {
      ref.current.playbackRate = value;
    }
  };

  useImperativeHandle(handle, () => ({
    seek: (seconds: number) => {
      const el = ref.current;
      if (el) {
        el.currentTime = seconds;
        void el.play();
      }
    },
  }));

  const total = Number.isFinite(duration) ? duration : 0;
  const percent = total > 0 ? (current / total) * 100 : 0;

  return (
    <div className="player">
      <audio
        ref={ref}
        src={src}
        preload="metadata"
        onPlay={() => setPlayingState(true)}
        onPause={() => setPlayingState(false)}
        onEnded={() => setPlayingState(false)}
        onTimeUpdate={(event) => {
          const value = event.currentTarget.currentTime;
          setCurrent(value);
          onTime?.(value);
        }}
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          setDuration(Number.isFinite(value) ? value : 0);
        }}
      />
      <button type="button" className="player-toggle" onClick={toggle} aria-label={playing ? "Pausar" : "Reproduzir"}>
        {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
      </button>
      <span className="player-time">{formatDuration(current)}</span>
      <input
        type="range"
        className="player-seek"
        min={0}
        max={total}
        step={0.1}
        value={current}
        onChange={(event) => seek(Number(event.target.value))}
        aria-label="Progresso do audio"
        style={{ background: `linear-gradient(to right, var(--color-accent) ${percent}%, var(--color-border) ${percent}%)` }}
      />
      <span className="player-time">{formatDuration(duration)}</span>
      <div className="player-menu">
        <button
          type="button"
          className="icon-button"
          onClick={() => setMenuOpen((value) => !value)}
          aria-label="Opcoes do audio"
          aria-expanded={menuOpen}
        >
          <MoreIcon size={16} />
        </button>
        {menuOpen && (
          <>
            <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
            <div className="menu" role="menu">
              <div className="menu-label">Velocidade</div>
              {RATES.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={value === rate}
                  className={value === rate ? "menu-item menu-item--active" : "menu-item"}
                  onClick={() => {
                    changeRate(value);
                    setMenuOpen(false);
                  }}
                >
                  <span>{value}x</span>
                  {value === rate && <CheckIcon size={14} />}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
});

export default AudioPlayer;
