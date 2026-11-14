import { clientOwnsStage, decideProcessing, type ProcessingInput } from '../processing';

const base: ProcessingInput = {
  place: 'device',
  hasServer: true,
  deviceCapable: true,
  deviceReady: true,
  onlineReady: false,
};

describe('decideProcessing', () => {
  it('aparelho escolhido e pronto roda aqui', () => {
    expect(decideProcessing(base)).toEqual({
      place: 'device',
      runsHere: true,
      runsOnDevice: true,
      needsModel: false,
      needsKey: false,
      needsServer: false,
      blocked: false,
    });
  });

  it('desligado nao roda e o servidor nao assume', () => {
    expect(decideProcessing({ ...base, place: 'off', hasServer: false })).toEqual({
      place: 'disabled',
      runsHere: false,
      runsOnDevice: false,
      needsModel: false,
      needsKey: false,
      needsServer: false,
      blocked: false,
    });
  });

  it('servidor escolhido e configurado processa la, mesmo com modelo baixado', () => {
    expect(decideProcessing({ ...base, place: 'server' })).toEqual({
      place: 'server',
      runsHere: false,
      runsOnDevice: false,
      needsModel: false,
      needsKey: false,
      needsServer: false,
      blocked: false,
    });
  });

  it('servidor escolhido e ausente fica bloqueado, sem cair para o aparelho', () => {
    expect(decideProcessing({ ...base, place: 'server', hasServer: false })).toEqual({
      place: 'server',
      runsHere: false,
      runsOnDevice: false,
      needsModel: false,
      needsKey: false,
      needsServer: true,
      blocked: true,
    });
  });

  it('aparelho escolhido sem modelo fica pendente, sem cair para o servidor', () => {
    expect(decideProcessing({ ...base, deviceReady: false })).toEqual({
      place: 'device',
      runsHere: false,
      runsOnDevice: false,
      needsModel: true,
      needsKey: false,
      needsServer: false,
      blocked: true,
    });
  });

  it('sem motor nativo o aparelho fica bloqueado, mesmo com servidor', () => {
    expect(decideProcessing({ ...base, deviceCapable: false })).toEqual({
      place: 'device',
      runsHere: false,
      runsOnDevice: false,
      needsModel: false,
      needsKey: false,
      needsServer: false,
      blocked: true,
      unsupported: true,
    });
  });

  it('online pronto roda aqui', () => {
    expect(decideProcessing({ ...base, place: 'online', onlineReady: true })).toEqual({
      place: 'online',
      runsHere: true,
      runsOnDevice: false,
      needsModel: false,
      needsKey: false,
      needsServer: false,
      blocked: false,
    });
  });

  it('online sem chave fica bloqueado e pede chave, sem usar o modelo local', () => {
    expect(decideProcessing({ ...base, place: 'online', onlineReady: false })).toEqual({
      place: 'online',
      runsHere: false,
      runsOnDevice: false,
      needsModel: false,
      needsKey: true,
      needsServer: false,
      blocked: true,
    });
  });
});

describe('clientOwnsStage', () => {
  it('so o servidor explicito tem a posse', () => {
    expect(clientOwnsStage('server')).toBe(false);
    expect(clientOwnsStage('device')).toBe(true);
    expect(clientOwnsStage('online')).toBe(true);
    expect(clientOwnsStage('disabled')).toBe(true);
  });
});
