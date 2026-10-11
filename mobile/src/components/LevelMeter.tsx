import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors } from '@/theme/tokens';

const BARS = 32;
const MAX_HEIGHT = 52;

/** Medidor de nivel ao vivo. `level` vai de 0 a 1. */
export function LevelMeter({ level, active }: { level: number; active: boolean }) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setPhase((p) => p + 0.7), 90);
    return () => clearInterval(id);
  }, [active]);

  const clamped = Math.max(0, Math.min(1, level));

  return (
    <View style={styles.row}>
      {Array.from({ length: BARS }).map((_, i) => {
        const wave = 0.35 + 0.65 * Math.abs(Math.sin(i * 0.55 + phase));
        const height = active ? 4 + clamped * MAX_HEIGHT * wave : 4;
        return (
          <View
            key={i}
            style={[
              styles.bar,
              {
                height,
                backgroundColor: active ? colors.record : colors.borderStrong,
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
    gap: 3,
    height: MAX_HEIGHT + 8,
  },
  bar: { width: 3, borderRadius: 2 },
});
