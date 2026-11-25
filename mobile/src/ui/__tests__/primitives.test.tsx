import { fireEvent, render, screen } from '@testing-library/react-native';
import { View } from 'react-native';

import { designColors } from '@/theme/design';
import { ThemeProvider } from '@/theme/ThemeContext';

import { Button, Field, Meter, designThemeFor, useDesign } from '../index';

let mockTheme: 'light' | 'dark' | 'amoled' = 'dark';

jest.mock('@/state/SettingsContext', () => ({
  useSettings: () => ({ theme: mockTheme }),
}));

describe('Button', () => {
  it('chama onPress ao tocar', () => {
    const onPress = jest.fn();
    render(<Button title="Salvar" onPress={onPress} />);

    fireEvent.press(screen.getByRole('button'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('nao chama onPress quando esta desabilitado', () => {
    const onPress = jest.fn();
    render(<Button title="Salvar" onPress={onPress} disabled />);

    fireEvent.press(screen.getByRole('button'));

    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('Field', () => {
  it('entrega o texto digitado em onChangeText', () => {
    const onChangeText = jest.fn();
    render(<Field label="Nome" value="" onChangeText={onChangeText} />);

    fireEvent.changeText(screen.getByLabelText('Nome'), 'consulta');

    expect(onChangeText).toHaveBeenCalledWith('consulta');
  });
});

describe('Meter', () => {
  it('expõe o valor atual em accessibilityValue.now', () => {
    render(<Meter value={42} />);

    expect(screen.getByRole('progressbar').props.accessibilityValue).toEqual({
      min: 0,
      max: 100,
      now: 42,
    });
  });
});

describe('useDesign', () => {
  it('mapeia o tema ativo para a paleta de design', () => {
    function Probe() {
      const colors = useDesign();
      return <View testID="probe" style={{ backgroundColor: colors.surface }} />;
    }

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('probe').props.style.backgroundColor).toBe(
      designColors.dark.surface,
    );
  });

  it('cai em light quando o tema nao existe no design', () => {
    expect(designThemeFor('sepia')).toBe('light');
    expect(designThemeFor('amoled')).toBe('amoled');
  });
});
