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
import { buildMetricsSnapshot, type MetricsSnapshot } from '@/core/metricsSnapshot';
import { Platform } from 'react-native';

import {
  listCachedAnalyses,
  listRecordings,
  loadMetricsSnapshot,
  markMetricsSynced,
  saveMetricsSnapshot,
} from './db';
import { loadDeviceIdentity, loadServerConfig, saveDeviceIdentity } from './secure';
import { scanImageBytes } from './storageScan';

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
  const [recordings, cached] = await Promise.all([
    listRecordings(),
    listCachedAnalyses().catch(() => []),
  ]);
  // A mesma analise que o Painel ve (local vence a do servidor) alimenta o
  // sentimento do snapshot; sem isso o web mostraria o lexico e o app a analise.
  const analyses = cached.map((item) => ({
    entryId: item.entryId,
    origin: item.origin ?? ('server' as const),
    contentHash: item.contentHash,
    model: item.analysis.model,
    sentiment: item.analysis.sentiment,
    sentimentLabel: item.analysis.sentiment_label,
    emotions: item.analysis.emotions,
    themes: (item.analysis.themes ?? []).map((theme) => theme.name),
    people: item.analysis.people ?? undefined,
    places: item.analysis.places ?? undefined,
  }));
  const snapshot = buildMetricsSnapshot(recordings, now, analyses, scanImageBytes(recordings));
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
    ...snapshot,
  });
  await markMetricsSynced(new Date().toISOString());
  return true;
}
