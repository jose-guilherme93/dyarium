/**
 * Metricas de escrita: calcula o snapshot no aparelho, guarda localmente (sempre,
 * pronto para enviar) e envia ao servidor quando existe um configurado.
 *
 * O calculo e o mesmo que o Painel mostra, entao o painel web nao precisa
 * recalcular nada: ele recebe o documento pronto. Sem servidor, o snapshot
 * continua no aparelho e sobe depois, sem perder nada.
 */

import { DyariumApi, type FetchLike } from '@/core/api';
import { newId } from '@/core/id';
import { METRICS_SCHEMA, buildMetricsSnapshot, type MetricsSnapshot } from '@/core/metricsSnapshot';
import { Platform } from 'react-native';

import {
  listRecordings,
  loadMetricsSnapshot,
  markMetricsSynced,
  saveMetricsSnapshot,
} from './db';
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
 * Recalcula e guarda o snapshot. Devolve o documento (para quem quiser inspecionar
 * sem ler o banco de novo).
 */
export async function refreshMetricsSnapshot(now: Date = new Date()): Promise<MetricsSnapshot> {
  const recordings = await listRecordings();
  const snapshot = buildMetricsSnapshot(recordings, now);
  await saveMetricsSnapshot(JSON.stringify(snapshot), snapshot.generated_at);
  return snapshot;
}

/** Ultimo snapshot guardado (payload cru + quando foi gerado/enviado). */
export async function storedMetricsSnapshot(): Promise<{ payload: string; generatedAt: string; syncedAt: string | null } | null> {
  return loadMetricsSnapshot();
}

/**
 * Recalcula, guarda e tenta enviar. Devolve `true` quando chegou ao servidor.
 * Falha de rede nao perde nada: o snapshot local ja esta atualizado.
 */
export async function syncMetrics(now: Date = new Date()): Promise<boolean> {
  const snapshot = await refreshMetricsSnapshot(now);
  const config = await loadServerConfig();
  if (!config) return false;

  const device = await deviceIdentity();
  const api = new DyariumApi(config, doFetch);
  await api.putMetrics({
    device_id: device.id,
    device_name: device.name,
    schema: METRICS_SCHEMA,
    generated_at: snapshot.generated_at,
    writing: snapshot.writing,
    history: snapshot.history,
  });
  await markMetricsSynced(new Date().toISOString());
  return true;
}
