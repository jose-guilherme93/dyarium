/**
 * Metricas de escrita: guarda o snapshot no aparelho (sempre, pronto para
 * enviar) e envia ao servidor quando existe um configurado.
 *
 * O documento vem pronto do Painel, que ja fez as contas com as notas em
 * memoria: recalcular a biblioteca aqui era uma segunda passada completa pela
 * thread de JS logo depois de a tela abrir. Sem servidor, o snapshot continua
 * no aparelho e sobe depois, sem perder nada.
 */

import { DyariumApi, type FetchLike } from '@/core/api';
import type { MetricsSnapshot } from '@/core/metricsSnapshot';

import { loadMetricsSnapshot, markMetricsSynced, saveMetricsSnapshot } from './db';
import { deviceIdentity } from './device';
import { loadServerConfig } from './secure';

const doFetch = globalThis.fetch as unknown as FetchLike;

/**
 * Guarda o snapshot no aparelho e tenta enviar. Devolve `true` quando chegou ao
 * servidor. Falha de rede nao perde nada: o snapshot local ja esta atualizado.
 */
export async function publishMetricsSnapshot(snapshot: MetricsSnapshot): Promise<boolean> {
  await saveMetricsSnapshot(JSON.stringify(snapshot), snapshot.generated_at);
  const config = await loadServerConfig();
  if (!config) return false;

  const device = await deviceIdentity();
  const api = new DyariumApi(config, doFetch);
  await api.putMetrics({
    device_id: device.id,
    device_name: device.name,
    ...snapshot,
  });
  await markMetricsSynced(new Date().toISOString());
  return true;
}

/**
 * Envia o snapshot ja guardado no aparelho para um ambiente especifico. Cada
 * servidor mantem o proprio painel; o app nao depende de nenhum deles para
 * funcionar, entao a falha de um nao impede o outro.
 */
export async function publishMetricsTo(api: DyariumApi): Promise<boolean> {
  const stored = await loadMetricsSnapshot();
  if (!stored) return false;
  let snapshot: MetricsSnapshot;
  try {
    snapshot = JSON.parse(stored.payload) as MetricsSnapshot;
  } catch {
    return false;
  }
  const device = await deviceIdentity();
  await api.putMetrics({
    device_id: device.id,
    device_name: device.name,
    ...snapshot,
  });
  return true;
}
