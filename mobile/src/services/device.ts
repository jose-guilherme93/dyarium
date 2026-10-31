/**
 * Identidade do aparelho. Um id opaco, criado uma vez e guardado no cofre, que
 * nomeia este aparelho nas metricas, na origem dos tombstones e no relogio de
 * versao. Sem ele, duas instalacoes do app seriam indistinguiveis e a ordem de
 * duas edicoes simultaneas ficaria ambigua.
 */

import { Platform } from 'react-native';

import { setClientOrigin } from '@/core/api';
import { newId } from '@/core/id';

import { loadDeviceIdentity, saveDeviceIdentity } from './secure';

// A identidade nao muda durante a execucao; ler o cofre a cada carimbo de
// versao seria uma ida ao keychain por tecla digitada.
let cached: { id: string; name: string } | null = null;

/** Id opaco do aparelho, criado uma vez e guardado no cofre. */
export async function deviceIdentity(): Promise<{ id: string; name: string }> {
  if (cached) {
    setClientOrigin(cached.id);
    return cached;
  }
  const existing = await loadDeviceIdentity();
  if (existing) {
    cached = existing;
    setClientOrigin(existing.id);
    return existing;
  }
  const created = { id: newId('dev_'), name: deviceLabel() };
  await saveDeviceIdentity(created).catch(() => undefined);
  cached = created;
  setClientOrigin(created.id);
  return created;
}

/** Rotulo legivel do aparelho; nada sensivel (so plataforma e versao). */
function deviceLabel(): string {
  const version =
    typeof Platform.Version === 'string' ? Platform.Version : String(Platform.Version ?? '');
  return version ? `${Platform.OS} ${version}` : Platform.OS;
}

/** Nome curto do aparelho para a versao de um campo. */
export function nodeFrom(identityId: string): string {
  // O formato da versao usa `-` como separador; o id do aparelho (`dev_...`) ja
  // e alfanumerico.
  return identityId.replace(/[^A-Za-z0-9_]/g, '');
}
