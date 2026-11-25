import { StyleSheet, View } from 'react-native';

import { designMark } from '@/theme/design';

import { useDesign } from './useDesign';

export type MarkState = 'done' | 'todo' | 'out';

const DEFAULT_LABEL: Record<MarkState, string> = {
  done: 'feito',
  todo: 'não feito',
  out: 'ficou de fora',
};

export interface StateMarkProps {
  state: MarkState;
  size?: number;
  label?: string;
}

/**
 * Marca de estado. A forma distingue antes da cor: disco cheio e feito, anel
 * vazio e nao feito, anel com traco e ficou de fora.
 */
export function StateMark({ state, size = designMark.size, label }: StateMarkProps) {
  const colors = useDesign();
  const color =
    state === 'done' ? colors.success : state === 'out' ? colors.warning : colors.textMuted;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label ?? DEFAULT_LABEL[state]}
      style={[
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: designMark.stroke,
          borderColor: color,
          backgroundColor: state === 'done' ? color : 'transparent',
        },
      ]}
    >
      {state === 'out' ? (
        <View
          style={[
            styles.tick,
            {
              backgroundColor: color,
              width: size - designMark.tick,
              height: designMark.stroke,
            },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  tick: {
    transform: [{ rotate: '-45deg' }],
  },
});
