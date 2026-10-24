/**
 * Data e hora de agora, grandes, para a tela de gravacao.
 *
 * O relogio vive em um componente proprio: ele muda a cada segundo e nao pode
 * re-renderizar a tela inteira (waveform, controles) junto.
 */

import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { formatClock } from '@/core/format';
import { baseColors, fontSize, spacing } from '@/theme/tokens';
import { useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

export function RecordClock() {
  const styles = useThemedStyles(baseStyles);

  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const { date, time } = formatClock(now);

  return (
    <View style={styles.block}>
      <Text style={styles.time} testID="record-clock-time">
        {time}
      </Text>
      <Text style={styles.date} testID="record-clock-date">
        {date}
      </Text>
    </View>
  );
}

const baseStyles = defineStyles({
  block: { alignItems: 'center', gap: spacing.xs },
  time: {
    color: baseColors.text,
    fontSize: fontSize.xxl,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.5,
  },
  date: { color: baseColors.textSecondary, fontSize: fontSize.lg },
});
