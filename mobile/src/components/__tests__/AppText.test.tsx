import { render, screen } from '@testing-library/react-native';

import { Text, TextInput } from '@/components/AppText';

describe('AppText', () => {
  it('usa Inter no peso do estilo, sem peso sintetico', () => {
    render(<Text style={{ fontWeight: '600' }}>titulo</Text>);

    expect(screen.getByText('titulo').props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fontFamily: 'Inter_600SemiBold', fontWeight: 'normal' }),
      ]),
    );
  });

  it('respeita a familia escolhida para a nota', () => {
    render(<Text style={{ fontFamily: 'serif', fontWeight: '700' }}>nota</Text>);

    expect(screen.getByText('nota').props.style).toEqual(
      expect.objectContaining({ fontFamily: 'serif', fontWeight: '700' }),
    );
  });

  it('aplica a mesma familia no campo de texto', () => {
    render(<TextInput placeholder="titulo" style={{ fontWeight: '700' }} />);

    expect(screen.getByPlaceholderText('titulo').props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fontFamily: 'Inter_700Bold', fontWeight: 'normal' }),
      ]),
    );
  });
});
