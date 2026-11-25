import { useLocalSearchParams } from 'expo-router';

import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { daySeries, type LogItem } from '@/core/projetoLog';
import type { Recording } from '@/core/types';
import { DayColumns } from '@/ui/projects/DayColumns';

import ProjectFolderScreen from '../projects/folder';
import ProjectsScreen from '../projects/index';
import ProjectSessionScreen from '../projects/session';

// Data congelada: 9 de novembro de 2026, meio-dia UTC. O periodo de 7 dias e o
// estado `interrupted` (12h sem atividade) ficam deterministas.
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

// Um fence v2 por nota (uma nota por sessao), mais o bloco humano e o v1
// legados que seguem vivos na lista de itens (docs/projetos.md).
const BODIES: Record<string, string> = {
  // Legado: cabecalho humano + itens + ":::details".
  'note-dyarium': [
    '## 2026-11-07 14:58 · vps-dev',
    '- **feat** terminal do mapa em tres camadas · a1b2c3d',
    '- **test** fisica do mapa com arrasto · c3d4e5f',
    ':::details',
    'Commits:',
    '- a1b2c3d terminal do mapa em tres camadas',
    ':::',
  ].join('\n'),
  // Fence canonico v1 (projeto sem diretorio).
  'note-caixa': [
    '## 2026-10-30 09:00 · notebook',
    '```dyarium-json',
    '{"v":1,"project":"caixa","date":"2026-10-30","time":"09:00","host":"notebook","detail":"concise","items":[{"kind":"fix","title":"saldo calculado duas vezes ao importar csv","commit":"4d5e6f7"}],"links":[{"label":"deploy","url":"https://example.com/deploy"}]}',
    '```',
  ].join('\n'),
  // Nota sem fence nem bloco.
  'note-livre': 'qualquer anotacao solta, sem bloco de sessao',

  // v2: duas sessoes no mesmo (maquina, caminho) -> no de pasta.
  'note-v2-a': [
    '```dyarium-json',
    '{"v":2,"kind":"session","machine":"work-notebook","path":"/home/joseti/projects/syncwin","session":"ses_a","state":"closed","opened":"2026-11-07T09:00:00Z","closed":"2026-11-07T17:00:00Z","date":"2026-11-07","time":"09:00","summary":"Trocar o painel web por um html estatico escrito pelo proprio pfsense.","items":[{"kind":"feat","title":"coletor de metricas","commit":"a1b2c3d"},{"kind":"feat","title":"html estatico","commit":"d4e5f6a"}],"commits":[{"hash":"a1b2c3d","message":"coletor"},{"hash":"d4e5f6a","message":"html"}]}',
    '```',
  ].join('\n'),
  'note-v2-b': [
    '```dyarium-json',
    '{"v":2,"kind":"session","machine":"work-notebook","path":"/home/joseti/projects/syncwin","session":"ses_b","state":"open","opened":"2026-11-08T10:00:00Z","date":"2026-11-08","time":"10:00","summary":"Remover o dashboard web do syncwin de vez.","items":[{"kind":"fix","title":"fuso nos rotulos do eixo","commit":"9f8e7d6"}],"commits":[{"hash":"9f8e7d6","message":"fuso"}]}',
    '```',
  ].join('\n'),
  // v2: caminho com uma sessao so -> linha solta, com o caminho na segunda linha.
  'note-v2-c': [
    '```dyarium-json',
    '{"v":2,"kind":"session","machine":"work-notebook","path":"/opt/homebridge","session":"ses_c","state":"closed","opened":"2026-11-05T19:00:00Z","closed":"2026-11-05T19:35:00Z","date":"2026-11-05","time":"19:00","items":[{"kind":"docs","title":"config do homebridge"}]}',
    '```',
  ].join('\n'),
  // v2: o MESMO caminho em outra maquina; sem atividade ha mais de 12h -> interrompida.
  'note-v2-d': [
    '```dyarium-json',
    '{"v":2,"kind":"session","machine":"hp240-debian","path":"/home/joseti/projects/syncwin","session":"ses_d","state":"open","opened":"2026-11-08T08:00:00Z","date":"2026-11-08","time":"08:00","items":[{"kind":"perf","title":"render em software sem gpu"}]}',
    '```',
  ].join('\n'),
};

jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(() => ({})),
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

const mockedParams = useLocalSearchParams as jest.Mock;

function note(
  id: string,
  title: string,
  updatedAt = '2026-10-01T10:00:00.000Z',
): Recording {
  return {
    id,
    title,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt,
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

/** Drena as leituras assincronas do SQLite que a tela faz em segundo plano. */
async function drain() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderScreen() {
  render(<ProjectsScreen />);
  await drain();
}

const RealDate = Date;

beforeAll(() => {
  const FrozenDate = new Proxy(RealDate, {
    construct(target, args) {
      if (args.length === 0) return new target(FROZEN_MS);
      return new target(...(args as [string | number | Date]));
    },
    get(target, prop, receiver) {
      // O estado `interrupted` e calculado com Date.now(); precisa seguir
      // congelado junto com `new Date()`.
      if (prop === 'now') return () => FROZEN_MS;
      return Reflect.get(target, prop, receiver);
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
  mockedParams.mockReturnValue({});
});

const v2Set = () => [
  note('note-v2-a', 'pfsense manda metricas', '2026-11-07T17:00:00.000Z'),
  note('note-v2-b', 'remove dashboard do syncwin', '2026-11-09T08:00:00.000Z'),
  note('note-v2-c', 'homebridge em ordem', '2026-11-05T19:35:00.000Z'),
  note('note-v2-d', 'emulador roda em software', '2026-11-08T20:00:00.000Z'),
];

async function renderSession(noteId: string) {
  mockedParams.mockReturnValue({ notebook: 'nb-projetos', note: noteId });
  render(<ProjectSessionScreen />);
  await drain();
}

async function renderFolder(machine: string, path: string) {
  mockedParams.mockReturnValue({ notebook: 'nb-projetos', machine, path });
  render(<ProjectFolderScreen />);
  await drain();
}

describe('arvore de projetos (fence v2)', () => {
  it('agrupa por maquina e caminho; pasta so com duas sessoes', async () => {
    mockRecordings = v2Set();
    await renderScreen();

    // Duas maquinas, nunca mescladas.
    expect(screen.getByTestId('machine-row-work-notebook')).toBeTruthy();
    expect(screen.getByTestId('machine-row-hp240-debian')).toBeTruthy();

    // (work-notebook, /home/joseti/projects/syncwin) tem 2 sessoes -> pasta.
    const folder = screen.getByLabelText('projects/syncwin, 2 sessões');
    expect(folder).toBeTruthy();
    expect(screen.getByTestId('folder-row-work-notebook|/home/joseti/projects/syncwin')).toBeTruthy();

    // Filhos da pasta.
    expect(screen.getByTestId('session-row-work-notebook|/home/joseti/projects/syncwin|ses_a')).toBeTruthy();
    expect(screen.getByTestId('session-row-work-notebook|/home/joseti/projects/syncwin|ses_b')).toBeTruthy();
  });

  it('caminho com uma sessao e linha solta com o caminho na segunda linha', async () => {
    mockRecordings = v2Set();
    await renderScreen();

    expect(screen.getByTestId('flat-path-work-notebook|/opt/homebridge|ses_c')).toBeTruthy();
    expect(screen.getByText('opt/homebridge')).toBeTruthy();
    // hp240 tem UMA sessao em /home/joseti/projects/syncwin: linha solta, nao pasta.
    expect(screen.getByTestId('session-row-hp240-debian|/home/joseti/projects/syncwin|ses_d')).toBeTruthy();
    expect(screen.queryByTestId('folder-row-hp240-debian|/home/joseti/projects/syncwin')).toBeNull();
    // O mesmo caminho aparece nas duas maquinas: duas linhas, sem fusao.
    expect(screen.getAllByText('projects/syncwin')).toHaveLength(2);
  });

  it('marca estados por forma: disco fechado, anel aberto, anel com traco interrompido', async () => {
    mockRecordings = v2Set();
    await renderScreen();

    expect(screen.getAllByTestId('state-mark-closed')).toHaveLength(2); // ses_a, ses_c
    expect(screen.getAllByTestId('state-mark-open')).toHaveLength(1); // ses_b
    expect(screen.getAllByTestId('state-mark-interrupted')).toHaveLength(1); // ses_d (16h sem atividade)
  });

  it('recolhe a maquina e o trilho dos filhos desaparece', async () => {
    mockRecordings = v2Set();
    await renderScreen();

    fireEvent.press(screen.getByTestId('machine-row-work-notebook'));
    expect(screen.queryByTestId('folder-row-work-notebook|/home/joseti/projects/syncwin')).toBeNull();
    fireEvent.press(screen.getByTestId('machine-row-work-notebook'));
    expect(screen.getByTestId('folder-row-work-notebook|/home/joseti/projects/syncwin')).toBeTruthy();
  });

  it('recolhe a pasta pelo chevron sem sair da arvore', async () => {
    mockRecordings = v2Set();
    await renderScreen();

    fireEvent.press(screen.getByTestId('folder-toggle-work-notebook|/home/joseti/projects/syncwin'));
    expect(screen.queryByTestId('session-row-work-notebook|/home/joseti/projects/syncwin|ses_a')).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('folder-toggle-work-notebook|/home/joseti/projects/syncwin'));
    expect(screen.getByTestId('session-row-work-notebook|/home/joseti/projects/syncwin|ses_a')).toBeTruthy();
  });

  it('tocar na sessao abre a tela da sessao; tocar na pasta abre o agregado', async () => {
    mockRecordings = v2Set();
    await renderScreen();

    fireEvent.press(screen.getByTestId('session-row-work-notebook|/home/joseti/projects/syncwin|ses_a'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/projects/session',
      params: { notebook: 'nb-projetos', note: 'note-v2-a' },
    });

    fireEvent.press(screen.getByTestId('folder-row-work-notebook|/home/joseti/projects/syncwin'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/projects/folder',
      params: {
        notebook: 'nb-projetos',
        machine: 'work-notebook',
        path: '/home/joseti/projects/syncwin',
      },
    });
  });
});

describe('projetos sem pasta (v1) na arvore', () => {
  const mixedSet = (): Recording[] => [
    ...v2Set(),
    note('note-dyarium', 'dyarium'),
    note('note-caixa', 'caixa'),
  ];

  it('lista os projetos sem pasta acima das maquinas, com marca, recencia e contagem', async () => {
    mockRecordings = mixedSet();
    await renderScreen();

    // Com dois projetos, o grupo comeca recolhido: rotulo com contagem, linhas fora.
    const head = screen.getByTestId('no-pasta-toggle');
    expect(head).toBeTruthy();
    expect(head.props.accessibilityLabel).toBe('Sem pasta, 2 projetos');
    expect(screen.queryByTestId('v1-row-note-caixa')).toBeNull();

    fireEvent.press(head);
    expect(screen.getByTestId('v1-row-note-caixa')).toBeTruthy();
    expect(screen.getByTestId('v1-row-note-dyarium')).toBeTruthy();
    // Recencia e numero na linha: a sessao de caixa e de 30/10 (9 dias antes do agora).
    expect(screen.getByTestId('v1-row-note-caixa').props.accessibilityLabel).toBe(
      'caixa, há 10 dias, 1 item',
    );

    // Acima das maquinas: a primeira linha tocavel do grupo e de projeto, a ultima e maquina.
    const order = screen
      .getAllByTestId(/^(v1-row-|machine-row-)/)
      .map((el) => (el.props as { testID: string }).testID);
    expect(order[0]).toMatch(/^v1-row-/);
    expect(order[order.length - 1]).toMatch(/^machine-row-/);
  });

  it('grupo com um projeto so ja vem aberto', async () => {
    mockRecordings = [note('note-caixa', 'caixa')];
    await renderScreen();
    expect(screen.getByTestId('v1-row-note-caixa')).toBeTruthy();
  });

  it('linha do projeto abre a nota de sessao do projeto', async () => {
    mockRecordings = [note('note-caixa', 'caixa')];
    await renderScreen();

    fireEvent.press(screen.getByTestId('v1-row-note-caixa'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/note/[id]',
      params: { id: 'note-caixa' },
    });
  });

  it('estado vazio so aparece quando nao ha maquinas nem projetos sem pasta', async () => {
    // So v1: sem "Sem sessões"; o grupo substitui o vazio.
    mockRecordings = [note('note-caixa', 'caixa')];
    await renderScreen();
    expect(screen.queryByText('Sem sessões')).toBeNull();
    expect(screen.getByTestId('v1-row-note-caixa')).toBeTruthy();
  });

  it('sessao de maquina e caminho continua agrupando como antes; sem v1, sem grupo', async () => {
    mockRecordings = v2Set();
    await renderScreen();

    expect(screen.queryByTestId('no-pasta-toggle')).toBeNull();
    expect(screen.getByTestId('folder-row-work-notebook|/home/joseti/projects/syncwin')).toBeTruthy();
    expect(screen.getByTestId('session-row-work-notebook|/home/joseti/projects/syncwin|ses_a')).toBeTruthy();
  });
});

describe('tela da sessao', () => {
  it('cabecalho com caminho em mono, nome, resumo, itens e grafico no fim', async () => {
    mockRecordings = v2Set();
    await renderSession('note-v2-a');

    // Caminho no cabecalho: os dois ultimos segmentos; o completo na etiqueta.
    expect(screen.getByTestId('session-path')).toHaveTextContent('projects/syncwin');
    expect(screen.getByLabelText('/home/joseti/projects/syncwin, work-notebook')).toBeTruthy();
    expect(screen.getByTestId('session-name')).toHaveTextContent('pfsense manda metricas');
    expect(screen.getByTestId('state-mark-closed')).toBeTruthy();

    // Abertura e fechamento em UTC, numero na frente nas contagens.
    expect(screen.getByText('7 nov 09:00 – 7 nov 17:00')).toBeTruthy();
    expect(screen.getByTestId('session-summary')).toHaveTextContent(
      'Trocar o painel web por um html estatico escrito pelo proprio pfsense.',
    );
    expect(screen.getByText('coletor de metricas')).toBeTruthy();
    expect(screen.getByText('html estatico')).toBeTruthy();
    expect(screen.getByText('a1b2c3d')).toBeTruthy();

    // O grafico fecha a tela: colunas por dia com a leitura do ultimo dia.
    expect(screen.getByTestId('chart-slot-2026-11-07')).toBeTruthy();
    expect(screen.getByTestId('chart-read')).toHaveTextContent('7 nov · 2 itens');

    // A nota crua segue alcancavel.
    fireEvent.press(screen.getByTestId('open-note'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/note/[id]', params: { id: 'note-v2-a' } });
  });

  it('sessao sem fence valido nao explode', async () => {
    mockRecordings = [note('note-livre', 'livre')];
    await renderSession('note-livre');
    expect(screen.getByText('Sem sessão')).toBeTruthy();
  });
});

describe('agregado da pasta', () => {
  it('numeros, composicao, sessoes no eixo e a lista que abre a sessao', async () => {
    mockRecordings = v2Set();
    await renderFolder('work-notebook', '/home/joseti/projects/syncwin');

    expect(screen.getByTestId('folder-path')).toHaveTextContent('projects/syncwin');
    expect(screen.getByTestId('stat-sessions')).toHaveTextContent('2');
    expect(screen.getByTestId('stat-items')).toHaveTextContent('3');
    expect(screen.getByTestId('stat-commits')).toHaveTextContent('3');
    expect(screen.getByTestId('folder-legend')).toHaveTextContent('2 feat · 1 fix');

    // Uma barra por sessao, no eixo real.
    expect(screen.getByTestId('axis-bar-work-notebook|/home/joseti/projects/syncwin|ses_a')).toBeTruthy();
    expect(screen.getByTestId('axis-bar-work-notebook|/home/joseti/projects/syncwin|ses_b')).toBeTruthy();
    // A leitura default e a sessao mais nova.
    expect(screen.getByTestId('axis-read')).toHaveTextContent('remove dashboard do syncwin · 1 item');

    fireEvent.press(screen.getByTestId('folder-session-work-notebook|/home/joseti/projects/syncwin|ses_a'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/projects/session',
      params: { notebook: 'nb-projetos', note: 'note-v2-a' },
    });
  });
});

describe('grafico de colunas por dia', () => {
  const item = (date: string, kind: string, title: string): LogItem => ({
    kind,
    title,
    project: 'syncwin',
    date,
    time: '09:00',
    sessionId: 'ses_x',
  });

  it('um ponto: uma coluna e um rotulo', async () => {
    const series = daySeries([
      item('2026-11-13', 'feat', 'a'),
      item('2026-11-13', 'fix', 'b'),
      item('2026-11-13', 'chore', 'c'),
    ]);
    render(<DayColumns series={series} />);
    expect(screen.getAllByTestId(/^chart-slot-/)).toHaveLength(1);
    expect(screen.getByText('13 nov')).toBeTruthy();
    expect(screen.getByTestId('chart-read')).toHaveTextContent('13 nov · 3 itens');
  });

  it('dois pontos dias seguidos: duas colunas, rotulos nas pontas', () => {
    const series = daySeries([
      item('2026-11-12', 'feat', 'a'),
      item('2026-11-13', 'fix', 'b'),
    ]);
    render(<DayColumns series={series} />);
    expect(screen.getByTestId('chart-slot-2026-11-12')).toBeTruthy();
    expect(screen.getByTestId('chart-slot-2026-11-13')).toBeTruthy();
    expect(screen.getByTestId('chart-read')).toHaveTextContent('13 nov · 1 item');
  });

  it('buraco de 6 dias: dias vazios continuam slots no eixo', () => {
    const series = daySeries([
      item('2026-11-04', 'feat', 'a'),
      item('2026-11-04', 'fix', 'b'),
      item('2026-11-11', 'feat', 'c'),
    ]);
    render(<DayColumns series={series} />);
    expect(series).toHaveLength(8);
    expect(screen.getByTestId('chart-slot-2026-11-04')).toBeTruthy();
    expect(screen.getByTestId('chart-slot-2026-11-11')).toBeTruthy();
    expect(screen.getByTestId('chart-empty-2026-11-05')).toBeTruthy();
    expect(screen.getByTestId('chart-empty-2026-11-10')).toBeTruthy();
    expect(screen.getAllByTestId(/^chart-empty-/)).toHaveLength(6);
  });

  it('tocar num dia atualiza a leitura abaixo do grafico', () => {
    const series = daySeries([
      item('2026-11-04', 'feat', 'a'),
      item('2026-11-04', 'fix', 'b'),
      item('2026-11-11', 'feat', 'c'),
    ]);
    render(<DayColumns series={series} />);
    expect(screen.getByTestId('chart-read')).toHaveTextContent('11 nov · 1 item');
    fireEvent.press(screen.getByTestId('chart-slot-2026-11-04'));
    expect(screen.getByTestId('chart-read')).toHaveTextContent('4 nov · 2 itens');
  });
});

describe('lista de itens continua viva', () => {
  it('as notas legadas continuam na aba Itens', async () => {
    mockRecordings = [note('note-dyarium', 'dyarium'), note('note-caixa', 'caixa')];
    await renderScreen();

    fireEvent.press(screen.getByTestId('tab-items'));
    expect(screen.getByText('7 nov 14:58 · vps-dev')).toBeTruthy();
    expect(screen.getByText('30 out 09:00 · notebook')).toBeTruthy();
    expect(screen.getByText('terminal do mapa em tres camadas')).toBeTruthy();
    expect(screen.getByText('fisica do mapa com arrasto')).toBeTruthy();
    expect(screen.getByText('saldo calculado duas vezes ao importar csv')).toBeTruthy();
    expect(screen.getByText('3 itens')).toBeTruthy();

    // Tocar num item legado abre a nota no leitor.
    fireEvent.press(screen.getByTestId('item-row-terminal do mapa em tres camadas'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/note/[id]',
      params: { id: 'note-dyarium' },
    });
  });

  it('o filtro por kind reduz os itens da lista', async () => {
    mockRecordings = [note('note-dyarium', 'dyarium'), note('note-caixa', 'caixa')];
    await renderScreen();
    fireEvent.press(screen.getByTestId('tab-items'));

    fireEvent.press(screen.getByTestId('chip-kind-fix'));
    expect(screen.getByText('saldo calculado duas vezes ao importar csv')).toBeTruthy();
    expect(screen.queryByText('terminal do mapa em tres camadas')).toBeNull();
    expect(screen.getByTestId('items-count')).toHaveTextContent('1 item');
  });

  it('o periodo de 7 dias corta sessoes mais velhas que a janela', async () => {
    mockRecordings = [note('note-dyarium', 'dyarium'), note('note-caixa', 'caixa')];
    await renderScreen();
    fireEvent.press(screen.getByTestId('tab-items'));

    fireEvent.press(screen.getByTestId('range-7'));
    expect(screen.queryByText('saldo calculado duas vezes ao importar csv')).toBeNull();
    expect(screen.getByText('terminal do mapa em tres camadas')).toBeTruthy();
    expect(screen.getByTestId('items-count')).toHaveTextContent('2 itens');

    fireEvent.press(screen.getByTestId('range-30'));
    expect(screen.getByText('saldo calculado duas vezes ao importar csv')).toBeTruthy();
  });

  it('a lista fica escopada ao no selecionado na arvore', async () => {
    mockRecordings = v2Set();
    await renderScreen();

    // Seleo a maquina work-notebook (um toque seleciona e recolhe; outro reexpande).
    fireEvent.press(screen.getByTestId('machine-row-work-notebook'));
    fireEvent.press(screen.getByTestId('machine-row-work-notebook'));
    fireEvent.press(screen.getByTestId('tab-items'));

    // So os itens das sessoes dela: os de hp240-debian ficam fora.
    expect(screen.getByText('coletor de metricas')).toBeTruthy();
    expect(screen.getByText('fuso nos rotulos do eixo')).toBeTruthy();
    expect(screen.getByText('config do homebridge')).toBeTruthy();
    expect(screen.queryByText('render em software sem gpu')).toBeNull();

    // O chip de escopo limpa a selecao e a lista volta toda.
    expect(screen.getByTestId('scope-chip')).toBeTruthy();
    fireEvent.press(screen.getByTestId('scope-chip'));
    expect(screen.getByText('render em software sem gpu')).toBeTruthy();
  });

  it('nota sem bloco de sessao cai no estado vazio', async () => {
    mockRecordings = [note('note-livre', 'livre')];
    await renderScreen();

    expect(screen.queryByTestId('no-pasta-toggle')).toBeNull();
    expect(screen.getByText('Sem sessões')).toBeTruthy();
    fireEvent.press(screen.getByTestId('tab-items'));
    expect(screen.getByText('Sem itens')).toBeTruthy();
    expect(screen.getByText('0 itens')).toBeTruthy();
  });
});
