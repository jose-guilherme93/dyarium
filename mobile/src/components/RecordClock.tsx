/**
 * Data e hora de agora, na tela de gravacao.
 *
 * O relogio vive em um componente proprio: ele muda a cada segundo e nao pode
 * re-renderizar a tela inteira (waveform, controles) junto. A hora corrente
 * situa quem vai falar; o cronometro da gravacao e outra coisa e fica no
 * `RecordTimer`.
 */

import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/AppText';
import { formatClock } from '@/core/format';
import { fontFamilyNative } from '@/core/typography';
import { designSpace, designType } from '@/theme/design';

import { useDesign } from '@/ui/useDesign';

export function RecordClock() {
  const colors = useDesign();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const { date, time } = formatClock(now);

  return (
    <View style={styles.block}>
      <Text
        testID="record-clock-time"
        style={[styles.time, { color: colors.text }]}
      >
        {time}
      </Text>
      <Text
        testID="record-clock-date"
        style={[styles.date, { color: colors.textMuted }]}
      >
        {date}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { alignItems: 'center', gap: designSpace.s2 },
  time: {
    fontSize: designType.clock.size,
    fontWeight: '600',
    lineHeight: designType.clock.size * designType.clock.lineHeight,
    letterSpacing: 0.4,
    fontVariant: ['tabular-nums'],
    fontFamily: fontFamilyNative('mono'),
  },
  date: {
    fontSize: designType.mono.size,
    fontWeight: '500',
    letterSpacing: 0.2,
    fontVariant: ['tabular-nums'],
    fontFamily: fontFamilyNative('mono'),
  },
});
