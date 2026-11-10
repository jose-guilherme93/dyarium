import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import type { BackupFrequency } from '@/core/backupSchedule';
import type { BackupInfo } from '@/services/backup';

import BackupScreen from '../backup';

const mockBack = jest.fn();
const mockPickBackupFolder = jest.fn();
const mockReadManifestSummary = jest.fn();
const mockRunBackup = jest.fn();
const mockRunRestore = jest.fn();
const mockSetBackupFolder = jest.fn(async () => undefined);
const mockSetBackupFrequency = jest.fn(async () => undefined);
const mockRefresh = jest.fn(async () => []);
const mockListRecordings = jest.fn(async () => []);
const mockReassert = jest.fn(async () => ({ restored: 0, recreated: 0, failed: 0 }));
const mockStartActivity = jest.fn();
const mockUpdateActivity = jest.fn();
const mockFinishActivity = jest.fn();
const mockCancelActivity = jest.fn();
const mockFailActivity = jest.fn();

let mockSettings: {
  backupFolder?: string;
  backupFrequency: BackupFrequency;
  setBackupFolder: (uri: string) => Promise<void>;
  setBackupFrequency: (value: BackupFrequency) => Promise<void>;
};

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    useFocusEffect: (callback: () => void | (() => void)) => {
      React.useEffect(callback, [callback]);
    },
  };
});

jest.mock('@/services/appNavigation', () => ({
  back: () => mockBack(),
}));

jest.mock('@/state/SettingsContext', () => ({
  useSettings: () => mockSettings,
}));

jest.mock('@/state/LibraryContext', () => ({
  useLibrary: () => ({ refresh: () => mockRefresh() }),
}));

jest.mock('@/services/backup', () => ({
  BackupError: class BackupError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
  pickBackupFolder: (...args: unknown[]) => mockPickBackupFolder(...args),
  readManifestSummary: (...args: unknown[]) => mockReadManifestSummary(...args),
  runBackup: (...args: unknown[]) => mockRunBackup(...args),
  runRestore: (...args: unknown[]) => mockRunRestore(...args),
}));

jest.mock('@/services/activity', () => ({
  startActivity: (...args: unknown[]) => mockStartActivity(...args),
  updateActivity: (...args: unknown[]) => mockUpdateActivity(...args),
  finishActivity: (...args: unknown[]) => mockFinishActivity(...args),
  cancelActivity: (...args: unknown[]) => mockCancelActivity(...args),
  failActivity: (...args: unknown[]) => mockFailActivity(...args),
}));

jest.mock('@/services/db', () => ({
  listRecordings: () => mockListRecordings(),
}));

jest.mock('@/services/reassert', () => ({
  reassertNotesOnServer: () => mockReassert(),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

const FOLDER = 'content://tree/documentos/backup';

function manifest(patch: Partial<BackupInfo> = {}): BackupInfo {
  return {
    notes: 12,
    files: 84,
    bytes: 312 * 1024 * 1024,
    createdAt: new Date().toISOString(),
    ...patch,
  };
}

async function renderBackup() {
  render(<BackupScreen />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('tela de backup', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSettings = {
      backupFolder: undefined,
      backupFrequency: 'off',
      setBackupFolder: mockSetBackupFolder,
      setBackupFrequency: mockSetBackupFrequency,
    };
    mockPickBackupFolder.mockResolvedValue(null);
    mockReadManifestSummary.mockResolvedValue(null);
    mockListRecordings.mockResolvedValue([]);
    mockReassert.mockResolvedValue({ restored: 0, recreated: 0, failed: 0 });
    mockRunRestore.mockResolvedValue({ notes: 0, files: 0, bytes: 0 });
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('sem pasta mostra o estado vazio e desliga as ações', async () => {
    await renderBackup();

    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.getByText('sem pasta')).toBeTruthy();
    expect(screen.getByLabelText('Fazer backup agora')).toBeDisabled();
    expect(screen.getByLabelText('Restaurar backup')).toBeDisabled();
  });

  it('com pasta e manifesto mostra o número de notas do backup', async () => {
    mockSettings.backupFolder = FOLDER;
    mockReadManifestSummary.mockResolvedValue(manifest());

    await renderBackup();

    expect(mockReadManifestSummary).toHaveBeenCalledWith(FOLDER);
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('Pasta')).toBeTruthy();
    expect(screen.getByText('Rotina')).toBeTruthy();
    expect(screen.getByText('backup')).toBeTruthy();
    expect(screen.getByLabelText('Fazer backup agora')).toBeEnabled();
  });

  it('o botão principal dispara o backup e mostra o progresso com parada', async () => {
    mockSettings.backupFolder = FOLDER;
    mockReadManifestSummary.mockResolvedValue(manifest());
    let finishBackup: (() => void) | undefined;
    mockRunBackup.mockImplementation(
      (_folder: string, onProgress?: (done: number, total: number) => void) =>
        new Promise((resolve) => {
          onProgress?.(3, 10);
          finishBackup = () => resolve({ notes: 3, files: 0, bytes: 0 });
        }),
    );

    await renderBackup();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Fazer backup agora'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockStartActivity).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'backup:local', kind: 'backup' }),
    );
    expect(mockRunBackup.mock.calls[0][0]).toBe(FOLDER);
    expect(screen.getByText('3/10')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Parar backup'));
      await Promise.resolve();
    });

    expect(mockUpdateActivity).toHaveBeenCalledWith('backup:local', {
      detail: 'Parando após a nota atual',
    });

    await act(async () => {
      finishBackup?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockFinishActivity).toHaveBeenCalled();
  });

  it('a rotina fica desligada enquanto o automático está desligado', async () => {
    await renderBackup();

    expect(screen.getByLabelText('Diário')).toBeDisabled();
    expect(screen.getByLabelText('Semanal')).toBeDisabled();
    expect(screen.getByLabelText('Mensal')).toBeDisabled();
  });

  it('com o automático ligado a rotina escolhida é salva', async () => {
    mockSettings.backupFrequency = 'weekly';
    await renderBackup();

    expect(screen.getByLabelText('Diário')).toBeEnabled();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Diário'));
    });

    expect(mockSetBackupFrequency).toHaveBeenCalledWith('daily');
  });

  it('ligar o automático volta para a última rotina, com semanal de padrão', async () => {
    await renderBackup();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Backup automático'));
    });

    expect(mockSetBackupFrequency).toHaveBeenCalledWith('weekly');
  });

  it('desligar o automático grava a rotina desligada', async () => {
    mockSettings.backupFrequency = 'monthly';
    await renderBackup();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Backup automático'));
    });

    expect(mockSetBackupFrequency).toHaveBeenCalledWith('off');
  });

  it('o lápis da pasta abre o seletor e só troca quando escolhe uma pasta', async () => {
    await renderBackup();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Escolher pasta'));
      await Promise.resolve();
    });

    expect(mockPickBackupFolder).toHaveBeenCalled();
    expect(mockSetBackupFolder).not.toHaveBeenCalled();
  });

  it('restaurar pede confirmação antes de rodar', async () => {
    mockSettings.backupFolder = FOLDER;
    mockReadManifestSummary.mockResolvedValue(manifest());

    await renderBackup();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Restaurar backup'));
    });

    expect(alertSpy).toHaveBeenCalled();
    expect(mockRunRestore).not.toHaveBeenCalled();

    const buttons = alertSpy.mock.calls[0][2] as
      | { text: string; onPress?: () => void }[]
      | undefined;
    const confirm = buttons?.find((button) => button.text === 'Restaurar');
    expect(confirm).toBeTruthy();

    await act(async () => {
      confirm?.onPress?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockRunRestore.mock.calls[0][0]).toBe(FOLDER);
    expect(mockReassert).toHaveBeenCalled();
  });

  it('o ícone de informação abre a folha do que entra no backup', async () => {
    await renderBackup();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('O que entra no backup'));
    });

    expect(screen.getByText('No backup')).toBeTruthy();
    expect(screen.getByText('Áudio')).toBeTruthy();
    expect(screen.getByText('Cache')).toBeTruthy();
  });
});
