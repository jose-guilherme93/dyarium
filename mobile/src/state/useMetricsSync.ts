/**
 * Mantem o snapshot das metricas atualizado e sincronizado.
 *
 * Roda ao abrir/voltar ao app, quando a lista de notas muda e de tempo em tempo
 * (o texto e salvo sem mexer na lista, como nos lembretes de escrita). Sem
 * servidor configurado o snapshot so fica guardado no aparelho.
 */

import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';

import { syncMetrics } from '@/services/metricsSync';

import { useLibrary } from './LibraryContext';

/** Reavalia de tempo em tempo (pega texto salvo sem mudar a lista de notas). */
const SYNC_INTERVAL_MS = 15 * 60 * 1000;

/** Espera a tela assentar antes de varrer a biblioteca (nunca no toque). */
const FIRST_SYNC_DELAY_MS = 2000;

/**
 * `enabled` fica falso enquanto o microfone abre ou grava. O recálculo percorre
 * a biblioteca e nao pode competir com o inicio da gravacao.
 */
export function useMetricsSync(enabled = true): void {
  const { recordings } = useLibrary();

  const sync = useCallback(async () => {
    if (!enabled) return;
    await syncMetrics().catch(() => undefined);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const first = setTimeout(() => void sync(), FIRST_SYNC_DELAY_MS);
    const interval = setInterval(() => void sync(), SYNC_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') void sync();
    });
    return () => {
      clearTimeout(first);
      clearInterval(interval);
      subscription.remove();
    };
  }, [sync, recordings.length, enabled]);
}
