import { StyleSheet, View } from 'react-native';

import type { SessionNoteState } from '@/core/projetoLog';
import { designMark, designMeter } from '@/theme/design';

import { useDesign } from '../useDesign';

/**
 * Marca de estado de uma sessao, por forma antes de cor (contrato da galeria):
 * disco preenchido e fechada, anel vazio e aberta, anel com traco e ficou de
 * fora (interrompida). Desenhada com Views e bordas, sem caractere nem SVG.
 */

const STATE_LABEL: Record<SessionNoteState, string> = {
  closed: 'fechada',
  open: 'aberta',
  interrupted: 'interrompida',
};

export interface StateMarkProps {
  state: SessionNoteState;
}

export function StateMark({ state }: StateMarkProps) {
  const colors = useDesign();
  const color =
    state === 'closed' ? colors.success : state === 'open' ? colors.primary : colors.warning;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={STATE_LABEL[state]}
      testID={`state-mark-${state}`}
      style={[
        styles.base,
        state === 'closed' ? styles.disc : styles.ring,
        { borderColor: color },
        state === 'closed' ? { backgroundColor: color } : null,
      ]}
    >
      {state === 'interrupted' ? (
        <View style={[styles.tick, { backgroundColor: color }]} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    width: designMark.size,
    height: designMark.size,
    borderRadius: designMark.size / 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 0,
    flexShrink: 0,
  },
  disc: {},
  ring: {
    borderWidth: designMark.stroke,
    backgroundColor: 'transparent',
  },
  tick: {
    width: designMark.tick,
    height: designMeter.height,
  },
});
