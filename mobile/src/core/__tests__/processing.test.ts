import { clientOwnsStage, decideProcessing, type ProcessingInput } from '../processing';

const base: ProcessingInput = {
  enabled: true,
  serverProcessing: false,
  hasServer: true,
  deviceCapable: true,
  deviceReady: true,
};

describe('decideProcessing', () => {
  it('modelo baixado dispensa o interruptor: transcreve no aparelho', () => {
    expect(decideProcessing({ ...base, enabled: false })).toEqual({
      place: 'device',
      runsOnDevice: true,
      needsModel: false,
    });
  });

  it('desligado sem modelo nao roda e o servidor nao assume', () => {
    expect(
      decideProcessing({ ...base, enabled: false, deviceReady: false, serverProcessing: true, hasServer: false }),
    ).toEqual({ place: 'disabled', runsOnDevice: false, needsModel: false });
  });

  it('sem servidor configurado a escolha do servidor nao vale', () => {
    expect(
      decideProcessing({ ...base, serverProcessing: true, hasServer: false }),
    ).toEqual({ place: 'device', runsOnDevice: true, needsModel: false });
  });

  it('servidor escolhido e configurado processa la, mesmo com modelo baixado', () => {
    expect(decideProcessing({ ...base, serverProcessing: true })).toEqual({
      place: 'server',
      runsOnDevice: false,
      needsModel: false,
    });
  });

  it('aparelho escolhido sem modelo fica pendente, sem cair para o servidor', () => {
    expect(decideProcessing({ ...base, deviceReady: false })).toEqual({
      place: 'device',
      runsOnDevice: false,
      needsModel: true,
    });
  });

  it('sem motor nativo mas com servidor, o servidor processa', () => {
    expect(decideProcessing({ ...base, deviceCapable: false })).toEqual({
      place: 'server',
      runsOnDevice: false,
      needsModel: false,
    });
  });

  it('sem motor nativo e sem servidor, nao ha quem rode', () => {
    expect(decideProcessing({ ...base, deviceCapable: false, hasServer: false })).toEqual({
      place: 'disabled',
      runsOnDevice: false,
      needsModel: false,
    });
  });
});

describe('clientOwnsStage', () => {
  it('so o servidor explicito tem a posse', () => {
    expect(clientOwnsStage('server')).toBe(false);
    expect(clientOwnsStage('device')).toBe(true);
    expect(clientOwnsStage('disabled')).toBe(true);
  });
});
