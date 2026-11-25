import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { designColors, designFont, designRow } from '@/theme/design';

import PerfilScreen from '../perfil';

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
    recordings: [{ id: 'a', deletedAt: null }, { id: 'b', deletedAt: 'x' }],
  }),
}));

function setDrive(patch: Record<string, unknown>) {
  mockDrive = {
    configured: true,
    status: 'off',
    busy: false,
    profile: null,
    summary: null,
    error: '',
    connect: mockConnect,
    sync: mockSync,
    disconnect: mockDisconnect,
    clearError: mockClearError,
    ...patch,
  };
}

async function renderPerfil() {
  render(<PerfilScreen />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function styleOf(testID: string) {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style) as Record<string, unknown>;
}

describe('tela de perfil, cabecalho', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setDrive({});
  });

  it('usa o cabecalho padrao com voltar e titulo', async () => {
    await renderPerfil();

    expect(screen.getByText('Perfil')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Voltar'));
    expect(mockBack).toHaveBeenCalled();
  });
});

describe('tela de perfil, identidade', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setDrive({});
  });

  it('mostra foto 44, nome e email em mono, sem frase de status', async () => {
    setDrive({
      status: 'connected',
      profile: { name: 'Ana Silva', email: 'ana@b.com', picture: 'http://pic' },
      summary: { notes: 12, attachments: 3, bytes: 1024, at: new Date().toISOString() },
    });
    await renderPerfil();

    expect(screen.getByText('Ana Silva')).toBeTruthy();
    expect(styleOf('perfil-avatar').width).toBe(designRow.touch);

    const email = StyleSheet.flatten(screen.getByText('ana@b.com').props.style) as {
      fontFamily: string;
      fontSize: number;
    };
    expect(email.fontFamily).toBe(designFont.monoStack);
    expect(email.fontSize).toBe(11.5);

    expect(screen.queryByText('Sessão vencida')).toBeNull();
    expect(screen.queryByText('Não conectado')).toBeNull();
  });

  it('usa as iniciais quando nao ha foto', async () => {
    setDrive({
      status: 'connected',
      profile: { name: 'Ana Silva', email: 'ana@b.com', picture: '' },
      summary: { notes: 0, attachments: 0, bytes: 0, at: new Date().toISOString() },
    });
    await renderPerfil();

    expect(screen.getByText('AS')).toBeTruthy();
  });
});

describe('tela de perfil, cartao do Drive', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setDrive({});
  });

  it('mostra marca de estado e os tres dados na ordem do prototipo', async () => {
    setDrive({
      status: 'connected',
      profile: { name: 'Ana', email: 'ana@b.com', picture: '' },
      summary: {
        notes: 12,
        attachments: 3,
        bytes: 1.2 * 1024 ** 3,
        at: new Date().toISOString(),
      },
    });
    await renderPerfil();

    const card = screen.getByTestId('perfil-drive-card');
    expect(within(card).getByText('Google Drive')).toBeTruthy();
    expect(within(card).getByText('1.2 GB · 12 notas')).toBeTruthy();
    expect(within(card).getByText('Último envio')).toBeTruthy();
    expect(within(card).getByText('No aparelho')).toBeTruthy();
    expect(within(card).getByText('1')).toBeTruthy();

    const mark = styleOf('perfil-drive-mark');
    expect(mark.backgroundColor).toBe(designColors.amoled.success);
  });

  it('nao escreve o estado no lugar do dado quando a sessao venceu', async () => {
    setDrive({
      status: 'expired',
      profile: { name: 'Ana', email: 'ana@b.com', picture: '' },
      summary: { notes: 12, attachments: 3, bytes: 1024, at: new Date().toISOString() },
    });
    await renderPerfil();

    expect(screen.queryByText('Sessão vencida')).toBeNull();
    expect(screen.getByText('1.0 KB · 12 notas')).toBeTruthy();

    const mark = styleOf('perfil-drive-mark');
    expect(mark.backgroundColor).toBe('transparent');
    expect(mark.borderColor).toBe(designColors.amoled.warning);
  });

  it('marca a falta de conta com anel tracejado e valor vazio', async () => {
    await renderPerfil();

    expect(screen.queryByText('Não conectado')).toBeNull();
    expect(screen.getByText('— notas')).toBeTruthy();

    const mark = styleOf('perfil-drive-mark');
    expect(mark.borderStyle).toBe('dashed');
    expect(screen.queryAllByTestId('perfil-drive-mark')).toHaveLength(1);
  });
});

describe('tela de perfil, acoes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setDrive({});
  });

  it('mostra SINCRONIZAR conectado e chama sync', async () => {
    setDrive({
      status: 'connected',
      profile: { name: 'Ana', email: 'ana@b.com', picture: '' },
      summary: { notes: 1, attachments: 0, bytes: 10, at: new Date().toISOString() },
    });
    await renderPerfil();

    expect(screen.queryByText('CONECTAR')).toBeNull();
    fireEvent.press(screen.getByText('SINCRONIZAR'));
    expect(mockSync).toHaveBeenCalled();
  });

  it('mostra CONECTAR sem conta e chama connect', async () => {
    await renderPerfil();

    expect(screen.queryByText('SINCRONIZAR')).toBeNull();
    fireEvent.press(screen.getByText('CONECTAR'));
    expect(mockConnect).toHaveBeenCalled();
  });

  it('mostra SINCRONIZANDO enquanto o Drive esta ocupado', async () => {
    setDrive({
      status: 'connected',
      busy: true,
      profile: { name: 'Ana', email: 'ana@b.com', picture: '' },
      summary: { notes: 1, attachments: 0, bytes: 10, at: new Date().toISOString() },
    });
    await renderPerfil();

    expect(screen.getByText('SINCRONIZANDO')).toBeTruthy();
  });

  it('trocar de conta chama connect', async () => {
    await renderPerfil();
    fireEvent.press(screen.getByText('TROCAR DE CONTA'));
    expect(mockConnect).toHaveBeenCalled();
  });

  it('sem conta fica so com CONECTAR e TROCAR DE CONTA, sem a linha de sair', async () => {
    await renderPerfil();

    expect(screen.getByText('CONECTAR')).toBeTruthy();
    expect(screen.getByText('TROCAR DE CONTA')).toBeTruthy();
    expect(screen.queryByTestId('perfil-signout')).toBeNull();
    expect(screen.queryByText('Sair desta conta')).toBeNull();
  });

  it('com sessao vencida a linha de sair continua disponivel', async () => {
    setDrive({
      status: 'expired',
      profile: { name: 'Ana', email: 'ana@b.com', picture: '' },
      summary: { notes: 1, attachments: 0, bytes: 10, at: new Date().toISOString() },
    });
    await renderPerfil();

    expect(screen.getByTestId('perfil-signout')).toBeTruthy();
  });

  it('sair desta conta e uma linha destrutiva de 44 no fim, com hairline acima', async () => {
    setDrive({
      status: 'connected',
      profile: { name: 'Ana', email: 'ana@b.com', picture: '' },
      summary: { notes: 1, attachments: 0, bytes: 10, at: new Date().toISOString() },
    });
    await renderPerfil();

    expect(screen.queryByText('SAIR DESTA CONTA')).toBeNull();

    const signout = screen.getByTestId('perfil-signout');
    const signoutStyle = styleOf('perfil-signout');
    expect(signoutStyle.height).toBe(designRow.touch);
    expect(signoutStyle.borderTopWidth).toBeGreaterThan(0);
    expect(signoutStyle.backgroundColor).toBeUndefined();

    const label = within(signout).getByText('Sair desta conta');
    const labelStyle = StyleSheet.flatten(label.props.style) as { color: string };
    expect(labelStyle.color).toBe(designColors.amoled.danger);

    fireEvent.press(label);
    expect(mockDisconnect).toHaveBeenCalled();
  });
});
