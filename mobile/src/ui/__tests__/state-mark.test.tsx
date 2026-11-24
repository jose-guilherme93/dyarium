import { render } from '@testing-library/react-native';

import { StateMark } from '../StateMark';

describe('StateMark', () => {
  it('feito anuncia feito', () => {
    const tree = render(<StateMark state="done" />);
    expect(tree.getByLabelText('feito')).toBeTruthy();
  });

  it('nao feito e ficou de fora tem rotulos proprios', () => {
    const todo = render(<StateMark state="todo" />);
    expect(todo.getByLabelText('não feito')).toBeTruthy();

    const out = render(<StateMark state="out" />);
    expect(out.getByLabelText('ficou de fora')).toBeTruthy();
  });

  it('aceita rotulo do dominio, como enviada', () => {
    const tree = render(<StateMark state="done" label="enviada" />);
    expect(tree.getByLabelText('enviada')).toBeTruthy();
  });
});
