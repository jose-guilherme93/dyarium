import { act, render, screen } from '@testing-library/react-native';

import { RecordClock } from '../RecordClock';

describe('RecordClock', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 2, 12, 14, 7, 0));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('mostra a hora e a data de agora', () => {
    render(<RecordClock />);

    expect(screen.getByTestId('record-clock-time')).toHaveTextContent('14:07');
    expect(screen.getByTestId('record-clock-date')).toHaveTextContent(
      'quinta-feira, 12 de março',
    );
  });

  it('anda com o relogio sem perder a data', () => {
    render(<RecordClock />);

    act(() => {
      jest.setSystemTime(new Date(2026, 2, 12, 14, 8, 0));
      jest.advanceTimersByTime(1000);
    });

    expect(screen.getByTestId('record-clock-time')).toHaveTextContent('14:08');
    expect(screen.getByTestId('record-clock-date')).toHaveTextContent(
      'quinta-feira, 12 de março',
    );
  });
});
