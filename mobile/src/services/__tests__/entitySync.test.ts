import { ApiError } from '@/core/api';

import { syncEntities } from '../entitySync';

const mockRename = jest.fn();
const mockSetIcon = jest.fn();
const mockClaimSelf = jest.fn();
const mockCatalog = jest.fn();

jest.mock('@/core/api', () => {
  const actual = jest.requireActual('@/core/api');
  return {
    ...actual,
    DyariumApi: jest.fn().mockImplementation(() => ({
      renameEntity: (...args: unknown[]) => mockRename(...args),
      setEntityIcon: (...args: unknown[]) => mockSetIcon(...args),
      claimSelf: (...args: unknown[]) => mockClaimSelf(...args),
      getEntityCatalog: () => mockCatalog(),
    })),
  };
});

const mockLoadConfig = jest.fn();
const mockOutbox = jest.fn();
const mockDeleteOutbox = jest.fn();
const mockMarkAttempt = jest.fn();
const mockApplyEntities = jest.fn();
const mockApplyOwnerAliases = jest.fn();

jest.mock('../secure', () => ({
  loadServerConfig: () => mockLoadConfig(),
}));

jest.mock('../db', () => ({
  listEntityOutbox: (limit: number) => mockOutbox(limit),
  deleteEntityOutbox: (id: string) => mockDeleteOutbox(id),
  markEntityOutboxAttempt: (id: string, error: string) => mockMarkAttempt(id, error),
  applyRemoteEntities: (remote: unknown, pending: unknown) => mockApplyEntities(remote, pending),
  applyRemoteOwnerAliases: (names: unknown) => mockApplyOwnerAliases(names),
}));

function op(patch: Record<string, unknown>) {
  return {
    id: 'op1',
    operation: 'rename',
    entityId: 'e1',
    kind: 'person',
    name: 'Maria',
    attempts: 0,
    ...patch,
  };
}

describe('syncEntities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOutbox.mockReset();
    mockRename.mockReset();
    mockCatalog.mockReset();
    mockLoadConfig.mockReset();
    mockLoadConfig.mockResolvedValue({ baseUrl: 'https://diary.test', token: 't' });
    mockCatalog.mockResolvedValue({
      entities: [
        {
          id: 'server-1',
          kind: 'person',
          name: 'Mariana',
          icon: 'star',
          updated_at: '2026-10-20T10:00:00Z',
          aliases: ['Maria'],
          entries: 1,
          mentions: 2,
          sentiment: 0,
          last_seen: null,
        },
      ],
      ownerAliases: ['João'],
    });
    mockDeleteOutbox.mockResolvedValue(undefined);
    mockMarkAttempt.mockResolvedValue(undefined);
    mockApplyEntities.mockResolvedValue(undefined);
    mockApplyOwnerAliases.mockResolvedValue(undefined);
    mockOutbox.mockResolvedValue([]);
    mockRename.mockResolvedValue({});
    mockSetIcon.mockResolvedValue({});
    mockClaimSelf.mockResolvedValue({ status: 'ok', owner: 'João' });
  });

  it('empurra a outbox em ordem e aplica o catálogo', async () => {
    mockOutbox
      .mockResolvedValueOnce([op({ operation: 'rename', nextName: 'Mariana' })])
      .mockResolvedValueOnce([op({ id: 'op2', operation: 'icon', icon: 'star' })])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await syncEntities();

    expect(mockRename).toHaveBeenCalledWith('person', 'Maria', 'Mariana');
    expect(mockSetIcon).toHaveBeenCalledWith('person', 'Maria', 'star');
    expect(mockDeleteOutbox).toHaveBeenNthCalledWith(1, 'op1');
    expect(mockDeleteOutbox).toHaveBeenNthCalledWith(2, 'op2');

    expect(mockApplyOwnerAliases).toHaveBeenCalledWith(['João']);
    expect(mockApplyEntities).toHaveBeenCalledWith(
      [
        {
          id: 'server-1',
          kind: 'person',
          name: 'Mariana',
          icon: 'star',
          updatedAt: '2026-10-20T10:00:00Z',
          aliases: ['Maria'],
        },
      ],
      new Set(),
    );
  });

  it('descarta a operação quando a entidade não existe mais no servidor', async () => {
    mockRename.mockRejectedValueOnce(new ApiError(404, 'not_found', 'entidade inexistente'));
    mockOutbox
      .mockResolvedValueOnce([op({ nextName: 'Mariana' })])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await syncEntities();

    expect(mockDeleteOutbox).toHaveBeenCalledWith('op1');
    expect(mockMarkAttempt).not.toHaveBeenCalled();
    expect(mockCatalog).toHaveBeenCalled();
  });

  it('guarda a operação quando o servidor falha e não puxa o catálogo', async () => {
    mockRename.mockRejectedValueOnce(new ApiError(500, 'internal', 'falhou'));
    mockOutbox.mockResolvedValueOnce([op({ nextName: 'Mariana' })]);

    await syncEntities();

    expect(mockMarkAttempt).toHaveBeenCalledWith('op1', 'falha ao sincronizar entidade');
    expect(mockDeleteOutbox).not.toHaveBeenCalled();
    expect(mockCatalog).not.toHaveBeenCalled();
  });

  it('não faz nada sem servidor configurado', async () => {
    mockLoadConfig.mockResolvedValue(null);

    await syncEntities();

    expect(mockOutbox).not.toHaveBeenCalled();
    expect(mockCatalog).not.toHaveBeenCalled();
  });
});
