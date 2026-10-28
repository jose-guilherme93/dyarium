import { act, render } from '@testing-library/react-native';

import type { MetricsSnapshot } from '@/core/metricsSnapshot';
import { useMetricsSync } from '@/state/useMetricsSync';

const mockPublish = jest.fn().mockResolvedValue(false);

jest.mock('../../services/metricsSync', () => ({
  publishMetricsSnapshot: (...args: unknown[]) => mockPublish(...args),
}));

const snapshot = {
  schema: 2,
  generated_at: '2026-10-14T18:00:00.000Z',
} as MetricsSnapshot;

function Probe({
  enabled,
  value = snapshot,
}: {
  enabled: boolean;
  value?: MetricsSnapshot | null;
}) {
  useMetricsSync(value, enabled);
  return null;
}

describe('useMetricsSync', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockPublish.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('nao recalcula enquanto o microfone abre ou grava', async () => {
    render(<Probe enabled={false} />);

    await act(async () => {
      jest.advanceTimersByTime(60_000);
      await Promise.resolve();
    });

    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('publica depois que a tela assenta', async () => {
    render(<Probe enabled />);

    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledWith(snapshot);
  });

  it('nao publica sem snapshot (metricas ainda nao montadas)', async () => {
    render(<Probe enabled value={null} />);

    await act(async () => {
      jest.advanceTimersByTime(60_000);
      await Promise.resolve();
    });

    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('reenvia quando o snapshot muda, sem calcular de novo', async () => {
    const { rerender } = render(<Probe enabled />);
    const next = { ...snapshot, generated_at: '2026-10-15T09:00:00.000Z' } as MetricsSnapshot;

    rerender(<Probe enabled value={next} />);

    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledWith(next);
  });
});
