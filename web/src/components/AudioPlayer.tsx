import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { formatDuration } from "../lib/format";
import { PauseIcon, PlayIcon } from "./icons";

interface AudioPlayerProps {
  src: string;
}

export interface AudioPlayerHandle {
  seek: (seconds: number) => void;
}

// AudioPlayer is a compact player for a note's original audio.
export const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(function AudioPlayer(
  { src }: AudioPlayerProps,
  handle,
) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [rate, setRate] = useState(1);

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    setRate(1);
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

  const seek = (value: number) => {
    const el = ref.current;
    if (el) {
      el.currentTime = value;
    }
    setCurrent(value);
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

  const changeRate = (value: number) => {
    setRate(value);
    if (ref.current) {
      ref.current.playbackRate = value;
    }
  };

  const total = Number.isFinite(duration) ? duration : 0;
  const percent = total > 0 ? (current / total) * 100 : 0;

  return (
    <div className="player">
      <audio
        ref={ref}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
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
        style={{ background: `linear-gradient(to right, var(--accent) ${percent}%, var(--border) ${percent}%)` }}
      />
      <span className="player-time">{formatDuration(duration)}</span>
      <select
        className="player-rate"
        value={rate}
        onChange={(event) => changeRate(Number(event.target.value))}
        aria-label="Velocidade de reproducao"
      >
        <option value={0.75}>0.75x</option>
        <option value={1}>1x</option>
        <option value={1.25}>1.25x</option>
        <option value={1.5}>1.5x</option>
        <option value={2}>2x</option>
      </select>
    </div>
  );
});

export default AudioPlayer;
