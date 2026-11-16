import { StyleSheet, Text, View } from 'react-native';

import { designFont, designMeter, designSpace, designType } from '@/theme/design';

import { useDesign } from './useDesign';

export interface MeterProps {
  value: number;
  max?: number;
  label?: string;
  showValue?: boolean;
}

export function Meter({ value, max = 100, label, showValue = true }: MeterProps) {
  const colors = useDesign();
  const now = Math.min(Math.max(value, 0), max);
  const fillWidth = `${max > 0 ? (now / max) * 100 : 0}%` as const;

  return (
    <View style={styles.wrap}>
      {label ? (
        <Text style={[styles.label, { color: colors.textMuted }]}>{label}</Text>
      ) : null}
      <View style={styles.row}>
        <View
          accessible
          accessibilityLabel={label}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max, now }}
          style={[styles.track, { backgroundColor: colors.line }]}
        >
          <View
            style={[styles.fill, { backgroundColor: colors.primary, width: fillWidth }]}
          />
        </View>
        {showValue ? (
          <Text style={[styles.value, { color: colors.textMuted }]}>
            {now}/{max}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: designSpace.s4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designMeter.gap,
  },
  track: {
    flex: 1,
    height: designMeter.height,
  },
  fill: {
    height: designMeter.height,
  },
  label: {
    fontFamily: designFont.regular,
    fontSize: designType.label.size,
    lineHeight: designType.label.size * designType.label.lineHeight,
    letterSpacing: designType.label.letterSpacing,
    textTransform: 'uppercase',
  },
  value: {
    flexShrink: 0,
    fontFamily: designFont.regular,
    fontSize: designType.mono.size,
    lineHeight: designType.mono.size * designType.mono.lineHeight,
    letterSpacing: designType.mono.letterSpacing,
    fontVariant: ['tabular-nums'],
  },
});
