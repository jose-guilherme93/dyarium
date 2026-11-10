import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { Recording } from '@/core/types';

import ProjectsScreen from '../projects';

// Data congelada: 9 de novembro de 2026, meio-dia UTC. O periodo de 7 dias e a
// janela de 35 dias da aba Projetos ficam deterministas.
const FROZEN_MS = Date.UTC(2026, 10, 9, 12, 0, 0);

const mockRefresh = jest.fn(async () => undefined);
const mockRefreshNotebooks = jest.fn(async () => undefined);
const mockPull = jest.fn();
const mockPush = jest.fn();
const mockGetRecording = jest.fn(async (id: string) => ({
  text: BODIES[id] ?? '',
}));

const NOTEBOOKS = [
  {
    id: 'notas-ao-acaso',
    name: 'Notas ao acaso',
    color: '',
    isDefault: true,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    dirty: false,
    synced: true,
  },
  {
    id: 'nb-projetos',
    name: 'Projetos',
    color: '',
    isDefault: false,
    kind: 'mcp' as const,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    dirty: false,
    synced: true,
  },
];

const BODIES: Record<string, string> = {
  // Bloco humano legado: cabecalho, itens e ":::details" com commits.
  'note-dyarium': [
    '## 2026-11-07 14:58 · vps-dev',
    '- **feat** terminal do mapa em tres camadas · a1b2c3d',
    '- **test** fisica do mapa com arrasto · c3d4e5f',
    ':::details',
    'Commits:',
    '- a1b2c3d terminal do mapa em tres camadas',
    ':::',
  ].join('\n'),
  // Fence canonico v1: mesmo conteudo em JSON de uma linha.
  'note-caixa': [
    '## 2026-10-30 09:00 · notebook',
    '```dyarium-json',
    '{"v":1,"project":"caixa","date":"2026-10-30","time":"09:00","host":"notebook","detail":"concise","items":[{"kind":"fix","title":"saldo calculado duas vezes ao importar csv","commit":"4d5e6f7"}],"links":[{"label":"deploy","url":"https://example.com/deploy"}]}',
    '```',
  ].join('\n'),
  // Nota sem fence nem bloco: markdown livre nao entra na tabela.
  'note-livre': 'qualquer anotacao solta, sem bloco de sessao',
};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('@/services/appNavigation', () => ({
  back: jest.fn(),
  push: (...args: unknown[]) => mockPush(...args),
}));

jest.mock('@/services/db', () => ({
  getRecording: (id: string) => mockGetRecording(id),
}));

jest.mock('@/state/LibraryContext', () => ({
  useLibrary: () => ({
    recordings: mockRecordings,
    notebooks: NOTEBOOKS,
    ready: true,
    refresh: mockRefresh,
    refreshNotebooks: mockRefreshNotebooks,
    pull: mockPull,
  }),
}));

let mockRecordings: Recording[] = [];

function note(id: string, title: string): Recording {
  return {
    id,
    title,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    recordedAt: '2026-10-01T10:00:00.000Z',
    dir: '',
    segmentCount: 0,
    offset: 0,
    attempts: 0,
    status: 'completed',
    notebookId: 'nb-projetos',
    text: BODIES[id] ?? '',
  };
}

async function renderScreen() {
  render(<ProjectsScreen />);
  // O corpo das notas vem do SQLite em segundo plano; drena as microtarefas.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const RealDate = Date;

beforeAll(() => {
  const FrozenDate = new Proxy(RealDate, {
    construct(target, args) {
      if (args.length === 0) return new target(FROZEN_MS);
      return new target(...(args as [string | number | Date]));
    },
  }) as unknown as DateConstructor;
  globalThis.Date = FrozenDate;
});

afterAll(() => {
  globalThis.Date = RealDate;
});

beforeEach(() => {
  mockPush.mockClear();
  mockGetRecording.mockClear();
});

describe('tela de projetos do caderno MCP', () => {
  it('duas notas viram as duas abas com os itens certos', async () => {
    mockRecordings = [note('note-dyarium', 'dyarium'), note('note-caixa', 'caixa')];
    await renderScreen();

    // Aba Itens: cartoes por sessao com cabecalho e os tres itens.
    expect(screen.getByText('· 7 nov · vps-dev')).toBeTruthy();
    expect(screen.getByText('· 30 out · notebook')).toBeTruthy();
    expect(screen.getByText('terminal do mapa em tres camadas')).toBeTruthy();
    expect(screen.getByText('fisica do mapa com arrasto')).toBeTruthy();
    expect(screen.getByText('saldo calculado duas vezes ao importar csv')).toBeTruthy();
    expect(screen.getByText('3 itens · 2 projetos')).toBeTruthy();

    // Aba Projetos: uma linha por projeto.
    fireEvent.press(screen.getByTestId('tab-projects'));
    expect(screen.getByTestId('project-row-note-dyarium')).toBeTruthy();
    expect(screen.getByTestId('project-row-note-caixa')).toBeTruthy();

    // Tocar no projeto expande; tocar num item abre a nota no leitor.
    fireEvent.press(screen.getByTestId('project-row-note-caixa'));
    fireEvent.press(screen.getByTestId('nota-note-caixa'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/note/[id]',
      params: { id: 'note-caixa' },
    });
  });

  it('o filtro por kind reduz os itens da lista', async () => {
    mockRecordings = [note('note-dyarium', 'dyarium'), note('note-caixa', 'caixa')];
    await renderScreen();

    fireEvent.press(screen.getByTestId('chip-kind-fix'));
    expect(screen.getByText('saldo calculado duas vezes ao importar csv')).toBeTruthy();
    expect(screen.queryByText('terminal do mapa em tres camadas')).toBeNull();
    expect(screen.getByText('1 item · 1 projeto')).toBeTruthy();
  });

  it('o periodo de 7 dias corta sessoes mais velhas que a janela', async () => {
    mockRecordings = [note('note-dyarium', 'dyarium'), note('note-caixa', 'caixa')];
    await renderScreen();

    // Com a data congelada em 9/11, a sessao de 30/10 de caixa fica fora.
    fireEvent.press(screen.getByTestId('range-7'));
    expect(screen.queryByText('saldo calculado duas vezes ao importar csv')).toBeNull();
    expect(screen.getByText('terminal do mapa em tres camadas')).toBeTruthy();
    expect(screen.getByText('2 itens · 1 projeto')).toBeTruthy();

    // 30 dias reinclude; tudo mantem.
    fireEvent.press(screen.getByTestId('range-30'));
    expect(screen.getByText('saldo calculado duas vezes ao importar csv')).toBeTruthy();
  });

  it('expandir um projeto mostra a sessao e os detalhes tecnicos', async () => {
    mockRecordings = [note('note-dyarium', 'dyarium'), note('note-caixa', 'caixa')];
    await renderScreen();

    fireEvent.press(screen.getByTestId('tab-projects'));
    fireEvent.press(screen.getByTestId('project-row-note-dyarium'));

    // Cabecalho da sessao e itens dentro do projeto expandido.
    expect(screen.getByText('7 nov')).toBeTruthy();
    expect(screen.getByText('· vps-dev')).toBeTruthy();
    expect(screen.getByText('terminal do mapa em tres camadas')).toBeTruthy();

    const [toggle] = screen.getAllByTestId(/^detalhes-/);
    fireEvent.press(toggle);
    expect(screen.getByText('a1b2c3d — terminal do mapa em tres camadas')).toBeTruthy();

    // O fence de caixa traz link, nao commit.
    fireEvent.press(screen.getByTestId('project-row-note-caixa'));
    const toggles = screen.getAllByTestId(/^detalhes-/);
    fireEvent.press(toggles[1]);
    expect(screen.getByText('deploy: https://example.com/deploy')).toBeTruthy();
  });

  it('nota sem bloco de sessao cai no estado vazio', async () => {
    mockRecordings = [note('note-livre', 'livre')];
    await renderScreen();

    expect(screen.getByText('Sem sessões')).toBeTruthy();
    expect(screen.getByText('0 itens · 0 projetos')).toBeTruthy();
  });
});
