import { render, screen } from '@testing-library/react-native';
import { Text, View } from 'react-native';

import { ThemeProvider, useTheme, useThemedStyles } from '../ThemeContext';
import { baseColors, THEMES } from '../tokens';
import { defineStyles } from '../themedStyles';

jest.mock('@/state/SettingsContext', () => ({
  useSettings: () => ({ theme: 'light' }),
}));

const baseStyles = defineStyles({
  card: {
    backgroundColor: baseColors.surface,
    borderColor: baseColors.borderStrong,
  },
});

function Probe() {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();
  return (
    <View testID="card" style={styles.card}>
      <Text testID="line" style={{ color: colors.text }}>
        oi
      </Text>
    </View>
  );
}

describe('ThemeProvider', () => {
  it('entrega a paleta escolhida para estilos e cores inline', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('card').props.style.backgroundColor).toBe(
      THEMES.light.colors.surface,
    );
    expect(screen.getByTestId('line').props.style.color).toBe(THEMES.light.colors.text);
  });
});
