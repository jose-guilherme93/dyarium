import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors } from '@/theme/tokens';

const DEFAULT_BARS = 44;

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Waveform decorativa e estavel a partir de um seed (o id da gravacao). */
function barsFromSeed(seed: string, count: number): number[] {
  const rand = mulberry32(hashSeed(seed) || 1);
  const bars: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const envelope = Math.sin((i / (count - 1)) * Math.PI);
    const value = 0.2 + 0.8 * rand();
    bars.push(Math.max(0.1, value * (0.35 + 0.65 * envelope)));
  }
  return bars;
}

interface WaveformProps {
  bars?: number;
  height?: number;
  seed?: string;
  /** Ultimo nivel ao vivo (0..1). Quando informado, a waveform anima. */
  level?: number;
  active?: boolean;
  /** Progresso de reproducao (0..1) para pintar o trecho tocado. */
  progress?: number;
  color?: string;
  progressColor?: string;
}

export function Waveform({
  bars = DEFAULT_BARS,
  height = 56,
  seed = 'dyarium',
  level = 0,
  active = false,
  progress,
  color = colors.textSecondary,
  progressColor = colors.record,
}: WaveformProps) {
  const [live, setLive] = useState<number[]>(() => new Array(bars).fill(0.08));
  const levelRef = useRef(level);

  useEffect(() => {
    levelRef.current = level;
  }, [level]);

  useEffect(() => {
    if (!active) return undefined;
    let first = true;
    const id = setInterval(() => {
      setLive((prev) => {
        const clamped = Math.max(0.05, Math.min(1, levelRef.current));
        const value = clamped * (0.45 + 0.55 * Math.random());
        if (first) {
          first = false;
          return new Array(bars).fill(value);
        }
        const next = prev.slice(1);
        next.push(value);
        return next;
      });
    }, 70);
    return () => clearInterval(id);
  }, [active, bars]);

  const amplitudes = active ? live : barsFromSeed(seed, bars);

  return (
    <View style={[styles.row, { height }]}>
      {amplitudes.map((amp, index) => {
        const filled = progress !== undefined && index / bars <= progress;
        return (
          <View
            key={index}
            style={[
              styles.bar,
              {
                height: Math.max(3, amp * height),
                backgroundColor: filled ? progressColor : color,
                opacity: active ? 0.95 : filled ? 1 : 0.7,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  bar: { width: 2.5, borderRadius: 2 },
});
