import type { Database } from '../port';

type Port = typeof import('../port');

/** Banco de mentira: a porta so transporta a referencia, nao chama metodo. */
const fakeDb = { marca: 'db' } as unknown as Database;

/** Modulo novo a cada teste: o registro e estado de modulo. */
function freshPort(): Port {
  let mod: Port | null = null;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../port') as Port;
  });
  return mod as unknown as Port;
}

describe('portas do nucleo', () => {
  it('sem driver, falha alto em vez de devolver nada', async () => {
    const port = freshPort();
    await expect(port.getDb()).rejects.toThrow(/registerDatabase/);
    await expect(port.getDbForUI()).rejects.toThrow(/registerDatabase/);
    await expect(port.currentDeviceIdentity()).rejects.toThrow(/registerDeviceIdentity/);
  });

  it('entrega o banco registrado, e a leitura cai na principal', async () => {
    const port = freshPort();
    port.registerDatabase(async () => fakeDb);
    await expect(port.getDb()).resolves.toBe(fakeDb);
    await expect(port.getDbForUI()).resolves.toBe(fakeDb);
  });

  it('usa a conexao de leitura quando ela existe', async () => {
    const port = freshPort();
    const leitura = { marca: 'leitura' } as unknown as Database;
    port.registerDatabase(
      async () => fakeDb,
      async () => leitura,
    );
    await expect(port.getDbForUI()).resolves.toBe(leitura);
  });

  it('entrega a identidade do aparelho', async () => {
    const port = freshPort();
    port.registerDeviceIdentity(async () => ({ id: 'dev_1', name: 'aqui' }));
    await expect(port.currentDeviceIdentity()).resolves.toEqual({ id: 'dev_1', name: 'aqui' });
  });

  it('cancelar atividade sem ligacao nao explode', () => {
    const port = freshPort();
    expect(() => port.cancelActivity('transcription:1', 'teste')).not.toThrow();
  });

  it('encaminha o cancelamento para o servico ligado', () => {
    const port = freshPort();
    const seen: string[] = [];
    port.registerActivityCancel((key, reason) => seen.push(`${key}|${reason}`));
    port.cancelActivity('transcription:1', 'Nota apagada');
    expect(seen).toEqual(['transcription:1|Nota apagada']);
  });
});
