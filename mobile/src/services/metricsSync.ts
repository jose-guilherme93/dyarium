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
import { newId } from '@/core/id';
import type { MetricsSnapshot } from '@/core/metricsSnapshot';
import { Platform } from 'react-native';

import { markMetricsSynced, saveMetricsSnapshot } from './db';
import { loadDeviceIdentity, loadServerConfig, saveDeviceIdentity } from './secure';

const doFetch = globalThis.fetch as unknown as FetchLike;

/** Id opaco do aparelho, criado uma vez e guardado no cofre. */
async function deviceIdentity(): Promise<{ id: string; name: string }> {
  const existing = await loadDeviceIdentity();
  if (existing) return existing;
  const created = { id: newId('dev_'), name: deviceLabel() };
  await saveDeviceIdentity(created).catch(() => undefined);
  return created;
}

/** Rotulo legivel do aparelho; nada sensivel (so plataforma e versao). */
function deviceLabel(): string {
  const version = typeof Platform.Version === 'string' ? Platform.Version : String(Platform.Version ?? '');
  return version ? `${Platform.OS} ${version}` : Platform.OS;
}

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
