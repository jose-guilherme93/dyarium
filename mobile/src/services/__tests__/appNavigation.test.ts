import { router } from 'expo-router';

import { back, push, replace, resetNavigationGuard } from '../appNavigation';

let mockCanGoBack = true;

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => mockCanGoBack,
  },
}));

const mockPush = router.push as jest.Mock;
const mockReplace = router.replace as jest.Mock;
const mockBack = router.back as jest.Mock;

describe('navegacao sem toque repetido', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    resetNavigationGuard();
    mockCanGoBack = true;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('nao empilha a mesma tela duas vezes no toque duplo', () => {
    push('/settings');
    push('/settings');

    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('permite o mesmo destino depois da janela de toque', () => {
    push('/settings');
    jest.advanceTimersByTime(800);
    push('/settings');

    expect(mockPush).toHaveBeenCalledTimes(2);
  });

  it('nao confunde dois destinos diferentes', () => {
    push({ pathname: '/note/[id]', params: { id: 'a' } });
    push({ pathname: '/note/[id]', params: { id: 'b' } });

    expect(mockPush).toHaveBeenCalledTimes(2);
  });

  it('nao volta duas telas com dois toques', () => {
    back();
    back();

    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('volta de novo depois da janela', () => {
    back();
    jest.advanceTimersByTime(700);
    back();

    expect(mockBack).toHaveBeenCalledTimes(2);
  });

  it('sem historico, vai para a home em vez de nao fazer nada', () => {
    mockCanGoBack = false;
    back();

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('guarda o replace repetido', () => {
    replace('/');
    replace('/');

    expect(mockReplace).toHaveBeenCalledTimes(1);
  });
});
