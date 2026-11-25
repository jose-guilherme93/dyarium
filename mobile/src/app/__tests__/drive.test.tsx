import { act, fireEvent, render, screen } from '@testing-library/react-native';

import DriveScreen from '../drive';

const mockBack = jest.fn();
const mockPush = jest.fn();
const mockConnect = jest.fn(async () => undefined);
const mockSync = jest.fn(async () => undefined);
const mockDisconnect = jest.fn(async () => undefined);
const mockClearError = jest.fn();

let mockDrive: Record<string, unknown> = {};

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
  push: (...args: unknown[]) => mockPush(...args),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('@/state/useDrive', () => ({
  useDrive: () => mockDrive,
}));

jest.mock('@/state/LibraryContext', () => ({
  useLibrary: () => ({
    ready: true,
    recordings: [{ id: 'a' }, { id: 'b' }],
  }),
}));

function setDrive(patch: Record<string, unknown>) {
  mockDrive = {
    configured: true,
    status: 'off',
    created: false,
    busy: false,
    stage: null,
    progress: null,
    summary: null,
    restored: null,
    error: '',
    connect: mockConnect,
    sync: mockSync,
    disconnect: mockDisconnect,
    clearError: mockClearError,
    ...patch,
  };
}

async function renderDrive() {
  render(<DriveScreen />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('tela do Google Drive', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setDrive({});
  });

  it('desconectado mostra stats e botao de entrar', async () => {
    await renderDrive();

    expect(screen.getByText('Google Drive')).toBeTruthy();
    expect(screen.getByText('OPCIONAL')).toBeTruthy();
    expect(screen.getByText('No aparelho')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('No Drive')).toBeTruthy();
    expect(screen.getByText('Conta')).toBeTruthy();
    expect(screen.getByText('Pasta')).toBeTruthy();
    expect(screen.getByText('Dyarium/')).toBeTruthy();
    expect(screen.getByLabelText('Entrar com Google')).toBeTruthy();
    expect(screen.getByLabelText('Sincronizar agora')).toBeDisabled();
  });

  it('indisponivel desabilita o botao principal', async () => {
    setDrive({ configured: false, status: 'unsupported' });
    await renderDrive();

    expect(screen.getByText('Google não configurado')).toBeTruthy();
    expect(screen.getByLabelText('Entrar com Google')).toBeDisabled();
  });

  it('ocupado mostra etapas e progresso', async () => {
    setDrive({
      busy: true,
      stage: 'applying',
      progress: { done: 84, total: 128 },
    });
    await renderDrive();

    expect(screen.getByText('Autorizando')).toBeTruthy();
    expect(screen.getByText('Lendo cofre')).toBeTruthy();
    expect(screen.getByText('Decifrando')).toBeTruthy();
    expect(screen.getByText('Aplicando')).toBeTruthy();
    expect(screen.getByText('Enviando')).toBeTruthy();
    expect(screen.getByText('84 / 128')).toBeTruthy();
  });

  it('conectado mostra stats, conta e acoes', async () => {
    setDrive({
      status: 'connected',
      summary: { notes: 12, attachments: 312, bytes: 2.1 * 1024 * 1024 * 1024, at: new Date().toISOString() },
    });
    await renderDrive();

    expect(screen.getByText('No Drive')).toBeTruthy();
    expect(screen.getByText('Anexos')).toBeTruthy();
    expect(screen.getByText('GB')).toBeTruthy();
    expect(screen.getByText('Conta')).toBeTruthy();
    expect(screen.getByText('Google')).toBeTruthy();
    expect(screen.getByText('Último envio')).toBeTruthy();
    expect(screen.getByLabelText('Sincronizar agora')).toBeTruthy();
    expect(screen.getByLabelText('Sair desta conta')).toBeTruthy();
  });

  it('conectado com cofre novo mostra aviso', async () => {
    setDrive({
      status: 'connected',
      created: true,
      summary: { notes: 1, attachments: 0, bytes: 1024, at: new Date().toISOString() },
    });
    await renderDrive();

    expect(screen.getByText('Cofre novo no Drive')).toBeTruthy();
  });

  it('vencido mostra a linha de erro e entrar', async () => {
    setDrive({ status: 'expired' });
    await renderDrive();

    expect(screen.getByText('Sessão do Google vencida.')).toBeTruthy();
    expect(screen.getByLabelText('Entrar com Google')).toBeTruthy();
  });

  it('erro aparece como linha curta', async () => {
    setDrive({ error: 'Sem conexão com o Drive.' });
    await renderDrive();

    expect(screen.getByText('Sem conexão com o Drive.')).toBeTruthy();
  });

  it('apos sincronizar mostra os numeros restaurados', async () => {
    setDrive({
      status: 'connected',
      summary: { notes: 128, attachments: 312, bytes: 1024, at: new Date().toISOString() },
      restored: { notes: 128, skipped: 0, notebooks: 3, attachments: 0, failedAttachments: 0 },
    });
    await renderDrive();

    expect(screen.getByText('128 notas · 3 cadernos')).toBeTruthy();
    // O login nao baixa anexo: a tela nao promete um numero de anexos baixados.
    expect(screen.queryByText(/anexos$/)).toBeNull();
  });

  it('nao mostra codigo de recuperacao nem senha', async () => {
    await renderDrive();
    expect(screen.queryByText(/recupera/i)).toBeNull();
    expect(screen.queryByText(/senha/i)).toBeNull();
  });
});
