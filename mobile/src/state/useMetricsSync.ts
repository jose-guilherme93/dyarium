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

export function useMetricsSync(): void {
  const { recordings } = useLibrary();

  const sync = useCallback(async () => {
    await syncMetrics().catch(() => undefined);
  }, []);

  useEffect(() => {
    void sync();
    const interval = setInterval(() => void sync(), SYNC_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') void sync();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [sync, recordings.length]);
}
