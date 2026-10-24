import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';

import { Press } from '@/components/Press';
import { useActivities } from '@/state/useActivities';
import { baseColors } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

interface HomeActivityButtonProps {
  onPress(): void;
}

/**
 * Botao do centro de atividade. Fica isolado num componente proprio para o
 * progresso de uma transcricao ou download atualizar so este icone, sem
 * re-renderizar a lista de notas inteira.
 */
export function HomeActivityButton({ onPress }: HomeActivityButtonProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

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
    <Press style={styles.button} onPress={onPress} accessibilityLabel={label}>
      <Ionicons
        name="notifications-outline"
        size={22}
        color={running > 0 ? colors.accent : colors.text}
      />
      {running > 0 || unread > 0 ? (
        <View
          style={[
            styles.dot,
            { backgroundColor: running > 0 ? colors.accent : colors.success },
          ]}
        />
      ) : null}
    </Press>
  );
}

const baseStyles = defineStyles({
  button: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  dot: {
    position: 'absolute',
    top: 7,
    right: 7,
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: baseColors.bg,
  },
});
