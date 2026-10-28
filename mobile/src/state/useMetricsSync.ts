/**
 * Guarda e envia o snapshot das metricas que o Painel acabou de montar.
 *
 * O documento chega pronto: recalcular a biblioteca aqui era uma segunda
 * passada completa pela thread de JS logo depois de a tela abrir. Roda depois
 * que a tela assenta (nunca no toque) e de tempo em tempo, para o snapshot
 * continuar subindo com o Painel aberto.
 */

import { useCallback, useEffect } from 'react';

import type { MetricsSnapshot } from '@/core/metricsSnapshot';
import { publishMetricsSnapshot } from '@/services/metricsSync';

/** Reavalia de tempo em tempo enquanto o Painel estiver aberto. */
const SYNC_INTERVAL_MS = 15 * 60 * 1000;

/** Espera a tela assentar antes de gravar/enviar (nunca no toque). */
const FIRST_SYNC_DELAY_MS = 2000;

/**
 * `snapshot` e o mesmo documento que o Painel mostra; `enabled` fica falso
 * enquanto o microfone abre ou grava.
 */
export function useMetricsSync(snapshot: MetricsSnapshot | null, enabled = true): void {
  const sync = useCallback(async () => {
    if (!enabled || !snapshot) return;
    await publishMetricsSnapshot(snapshot).catch(() => undefined);
  }, [enabled, snapshot]);

  useEffect(() => {
    if (!enabled || !snapshot) return undefined;
    const first = setTimeout(() => void sync(), FIRST_SYNC_DELAY_MS);
    const interval = setInterval(() => void sync(), SYNC_INTERVAL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [enabled, snapshot, sync]);
}
