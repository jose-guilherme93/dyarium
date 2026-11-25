import { render, screen } from '@testing-library/react-native';

import { Text, TextInput } from '@/components/AppText';

describe('AppText', () => {
  it('usa Schibsted SemiBold a partir do peso 600, sem peso sintetico', () => {
    render(<Text style={{ fontWeight: '600' }}>titulo</Text>);

    expect(screen.getByText('titulo').props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fontFamily: 'SchibstedGrotesk-SemiBold', fontWeight: 'normal' }),
      ]),
    );
  });

  it('usa Schibsted Medium ate o peso 500', () => {
    render(<Text style={{ fontWeight: '500' }}>corpo</Text>);

    expect(screen.getByText('corpo').props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fontFamily: 'SchibstedGrotesk-Medium', fontWeight: 'normal' }),
      ]),
    );
  });

  it('usa Medium no italico, porque nao ha italico Schibsted no bundle', () => {
    render(
      <Text style={{ fontStyle: 'italic', fontWeight: '600' }}>
        pensamento
      </Text>,
    );

    expect(screen.getByText('pensamento').props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fontFamily: 'SchibstedGrotesk-Medium', fontWeight: 'normal' }),
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
        expect.objectContaining({ fontFamily: 'SchibstedGrotesk-SemiBold', fontWeight: 'normal' }),
      ]),
    );
  });
});
