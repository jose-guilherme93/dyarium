import { act, render } from '@testing-library/react-native';

import { useMetricsSync } from '@/state/useMetricsSync';

const mockSyncMetrics = jest.fn().mockResolvedValue(false);

jest.mock('../LibraryContext', () => ({
  useLibrary: () => ({ recordings: [] }),
}));

jest.mock('../../services/metricsSync', () => ({
  syncMetrics: (...args: unknown[]) => mockSyncMetrics(...args),
}));

function Probe({ enabled }: { enabled: boolean }) {
  useMetricsSync(enabled);
  return null;
}

describe('useMetricsSync', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockSyncMetrics.mockClear();
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

    expect(mockSyncMetrics).not.toHaveBeenCalled();
  });

  it('recalcula depois que a tela assenta', async () => {
    render(<Probe enabled />);

    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    expect(mockSyncMetrics).toHaveBeenCalledTimes(1);
  });
});
