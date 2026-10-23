import { act, render } from '@testing-library/react-native';

import { useWritingReminders } from '@/state/useWritingReminders';

const mockSyncWritingReminder = jest.fn().mockResolvedValue(undefined);
const mockSettings = {
  weeklyWordGoal: 0,
  writingReminders: false,
  reminderHour: 20,
  celebratedWords: 0,
  celebratedStreak: 0,
  setCelebratedWords: jest.fn(),
  setCelebratedStreak: jest.fn(),
};

jest.mock('../LibraryContext', () => ({
  useLibrary: () => ({ recordings: [] }),
}));

jest.mock('../SettingsContext', () => ({
  useSettings: () => mockSettings,
}));

jest.mock('../../services/notifications', () => ({
  syncWritingReminder: (...args: unknown[]) => mockSyncWritingReminder(...args),
  notify: jest.fn(),
}));

function Probe({ enabled }: { enabled: boolean }) {
  useWritingReminders(enabled);
  return null;
}

describe('useWritingReminders', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockSyncWritingReminder.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('nao analisa a biblioteca enquanto o microfone abre ou grava', async () => {
    render(<Probe enabled={false} />);

    await act(async () => {
      jest.advanceTimersByTime(60_000);
      await Promise.resolve();
    });

    expect(mockSyncWritingReminder).not.toHaveBeenCalled();
  });

  it('reavalia depois que a tela assenta', async () => {
    render(<Probe enabled />);

    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    expect(mockSyncWritingReminder).toHaveBeenCalledTimes(1);
  });
});
