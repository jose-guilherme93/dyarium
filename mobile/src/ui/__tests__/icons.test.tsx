import { render } from '@testing-library/react-native';

import { designIcon } from '@/theme/design';

import { Icon, iconFor } from '../icons';

describe('Icon', () => {
  it('mapeia todos os nomes do sistema para um icone do app', () => {
    for (const name of designIcon.set) {
      expect(iconFor(name)).toBeTruthy();
    }
  });

  it('desenha o nome com o traco pedido', () => {
    const tree = render(<Icon name="mic" size={20} color="#a2b8ae" label="gravar" />);

    expect(tree.getByLabelText('gravar')).toBeTruthy();
  });

  it('desenha pelo menos um icone por familia da barra', () => {
    for (const name of ['menu', 'search', 'mic', 'more', 'sync'] as const) {
      const tree = render(<Icon name={name} />);
      expect(tree.toJSON()).toBeTruthy();
    }
  });
});
