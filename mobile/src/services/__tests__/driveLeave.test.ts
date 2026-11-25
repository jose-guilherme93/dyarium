import { DriveLeaveError, leaveDriveAccount, type DriveLeaveDeps } from '../driveLeave';
import type { DriveSessionState } from '../driveAuth';

function deps(overrides: Partial<DriveLeaveDeps> = {}): DriveLeaveDeps & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    loadSession: async () => {
      calls.push('load');
    },
    sessionState: (() => 'connected') as () => DriveSessionState,
    localPending: async () => true,
    ensureBackedUp: async () => {
      calls.push('backup');
    },
    disconnect: async () => {
      calls.push('disconnect');
    },
    wipe: async () => {
      calls.push('wipe');
    },
    pause: async () => {
      calls.push('pause');
    },
    resume: () => {
      calls.push('resume');
    },
    ...overrides,
  };
}

describe('sair da conta do Drive', () => {
  it('sincroniza, confere, limpa a sessao e so entao apaga o cache', async () => {
    const fake = deps();
    await leaveDriveAccount(fake);

    expect(fake.calls).toEqual(['pause', 'load', 'backup', 'wipe', 'disconnect', 'resume']);
  });

  it('se o envio falhar, nao apaga e devolve erro', async () => {
    const fake = deps({
      ensureBackedUp: async () => {
        throw new Error('sem rede');
      },
    });

    await expect(leaveDriveAccount(fake)).rejects.toMatchObject({
      name: 'DriveLeaveError',
      code: 'sync_failed',
    });
    expect(fake.calls).toEqual(['pause', 'load', 'resume']);
    expect(fake.calls).not.toContain('disconnect');
    expect(fake.calls).not.toContain('wipe');
  });

  it('sem sessao e com pendencia, nao apaga e exige reconectar', async () => {
    const fake = deps({
      sessionState: () => 'expired',
      localPending: async () => true,
    });

    await expect(leaveDriveAccount(fake)).rejects.toMatchObject({
      name: 'DriveLeaveError',
      code: 'unsynced',
    });
    expect(fake.calls).not.toContain('backup');
    expect(fake.calls).not.toContain('disconnect');
    expect(fake.calls).not.toContain('wipe');
  });

  it('sem sessao e sem dados locais, so limpa o que restou', async () => {
    const fake = deps({
      sessionState: () => 'off',
      localPending: async () => false,
    });

    await leaveDriveAccount(fake);
    expect(fake.calls).toEqual(['pause', 'load', 'wipe', 'disconnect', 'resume']);
  });

  it('expiracao de token nunca apaga por conta propria', async () => {
    const fake = deps({
      sessionState: () => 'expired',
      localPending: async () => true,
    });

    const error = await leaveDriveAccount(fake).catch((caught) => caught as DriveLeaveError);
    expect(error).toBeInstanceOf(DriveLeaveError);
    expect((error as DriveLeaveError).code).toBe('unsynced');
    expect(fake.calls).not.toContain('wipe');
  });

  it('falha ao apagar o banco vira erro e mantem a sessao de pe', async () => {
    const fake = deps({
      wipe: async () => {
        throw new Error('banco travado');
      },
    });

    await expect(leaveDriveAccount(fake)).rejects.toMatchObject({
      name: 'DriveLeaveError',
      code: 'wipe_failed',
    });
    // A sessao fica de pe para o usuario tentar de novo; o cache nao aparece
    // como modo local.
    expect(fake.calls).not.toContain('disconnect');
  });
});
