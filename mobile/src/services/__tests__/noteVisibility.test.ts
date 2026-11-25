import {
  backgroundPaused,
  enterInteractiveView,
  enterNote,
  leaveInteractiveView,
  leaveNote,
  noteIsOpen,
} from '../noteVisibility';

/**
 * O trabalho de fundo espera enquanto a nota ou o mapa estao na frente. Sem
 * isso, o pull de 20 s varria a biblioteca no meio do arrasto do grafo.
 */
describe('noteVisibility', () => {
  it('pausa o fundo com uma nota aberta', () => {
    enterNote();
    expect(noteIsOpen()).toBe(true);
    expect(backgroundPaused()).toBe(true);
    leaveNote();
    expect(backgroundPaused()).toBe(false);
  });

  it('pausa o fundo com uma superficie interativa aberta', () => {
    enterInteractiveView();
    expect(noteIsOpen()).toBe(false);
    expect(backgroundPaused()).toBe(true);
    leaveInteractiveView();
    expect(backgroundPaused()).toBe(false);
  });

  it('so volta a rodar quando a ultima superficie fecha', () => {
    enterNote();
    enterInteractiveView();
    leaveNote();
    expect(backgroundPaused()).toBe(true);
    leaveInteractiveView();
    expect(backgroundPaused()).toBe(false);
  });
});
