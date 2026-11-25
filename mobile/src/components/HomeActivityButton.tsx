import { StyleSheet, View } from 'react-native';

import { Press } from '@/components/Press';
import { useActivities } from '@/state/useActivities';
import { designFocus, designIcon, designRadius, designRow, designSpace } from '@/theme/design';

import { Icon } from '@/ui/icons';
import { useDesign } from '@/ui/useDesign';

interface HomeActivityButtonProps {
  onPress(): void;
}

/**
 * Botao do centro de atividade. Fica isolado num componente proprio para o
 * progresso de uma transcricao ou download atualizar so este icone, sem
 * re-renderizar a lista de notas inteira.
 */
export function HomeActivityButton({ onPress }: HomeActivityButtonProps) {
  const colors = useDesign();
  const activities = useActivities();
  const running = activities.filter((item) => item.status === 'running').length;
  const unread = activities.filter(
    (item) => item.status !== 'running' && !item.seen,
  ).length;
  const label =
    running > 0
      ? `Atividade. ${running} em andamento`
      : unread > 0
        ? `Atividade. ${unread} novidade${unread === 1 ? '' : 's'}`
        : 'Atividade';

  return (
    <Press
      style={styles.button}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon
        name="bell"
        size={designIcon.box}
        color={running > 0 ? colors.primary : colors.text}
      />
      {running > 0 || unread > 0 ? (
        <View
          style={[
            styles.dot,
            {
              backgroundColor: running > 0 ? colors.primary : colors.success,
              borderColor: colors.surface,
            },
          ]}
        />
      ) : null}
    </Press>
  );
}

const styles = StyleSheet.create({
  button: {
    width: designRow.touch,
    height: designRow.touch,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    top: designSpace.s8 + designSpace.s2,
    right: designSpace.s8 + designSpace.s2,
    width: designSpace.s6,
    height: designSpace.s6,
    borderRadius: designRadius.surface,
    borderWidth: designFocus.width,
  },
});
