import type { MetricsSnapshot } from '@/core/metricsSnapshot';

import { publishMetricsSnapshot } from '../metricsSync';

const mockSaveMetricsSnapshot = jest.fn().mockResolvedValue(undefined);
const mockMarkMetricsSynced = jest.fn().mockResolvedValue(undefined);
const mockLoadServerConfig = jest.fn();
const mockLoadDeviceIdentity = jest.fn();
const mockSaveDeviceIdentity = jest.fn().mockResolvedValue(undefined);
const mockPutMetrics = jest.fn().mockResolvedValue(undefined);

jest.mock('../db', () => ({
  saveMetricsSnapshot: (...args: unknown[]) => mockSaveMetricsSnapshot(...args),
  markMetricsSynced: (...args: unknown[]) => mockMarkMetricsSynced(...args),
}));

jest.mock('../secure', () => ({
  loadServerConfig: () => mockLoadServerConfig(),
  loadDeviceIdentity: () => mockLoadDeviceIdentity(),
  saveDeviceIdentity: (...args: unknown[]) => mockSaveDeviceIdentity(...args),
}));

jest.mock('@/core/api', () => ({
  DyariumApi: class {
    putMetrics(payload: unknown): Promise<void> {
      return mockPutMetrics(payload);
    }
  },
}));

const snapshot = {
  schema: 2,
  generated_at: '2026-10-14T18:00:00.000Z',
  streak: { current: 1, longest: 1, wrote_today: true },
  windows: {},
  history: { weekly: [], calendar: [], max_weekly: 0, max_daily: 0 },
} as unknown as MetricsSnapshot;

describe('publishMetricsSnapshot', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadDeviceIdentity.mockResolvedValue({ id: 'dev_1', name: 'android 15' });
  });

  it('guarda e envia o documento que o Painel montou', async () => {
    mockLoadServerConfig.mockResolvedValue({ baseUrl: 'https://dyarium.test', token: 'segredo' });

    await expect(publishMetricsSnapshot(snapshot)).resolves.toBe(true);

    expect(mockSaveMetricsSnapshot).toHaveBeenCalledWith(
      JSON.stringify(snapshot),
      snapshot.generated_at,
    );
    expect(mockPutMetrics).toHaveBeenCalledWith(
      expect.objectContaining({
        device_id: 'dev_1',
        device_name: 'android 15',
        schema: 2,
        generated_at: snapshot.generated_at,
      }),
    );
    expect(mockMarkMetricsSynced).toHaveBeenCalled();
  });

  it('sem servidor configurado, apenas guarda no aparelho', async () => {
    mockLoadServerConfig.mockResolvedValue(null);

    await expect(publishMetricsSnapshot(snapshot)).resolves.toBe(false);

    expect(mockSaveMetricsSnapshot).toHaveBeenCalledTimes(1);
    expect(mockPutMetrics).not.toHaveBeenCalled();
  });
});
