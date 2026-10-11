/**
 * Configuracao do servidor no SecureStore (Android Keystore / iOS Keychain).
 * O token nunca e gravado em texto puro no armazenamento comum.
 */

import * as SecureStore from 'expo-secure-store';

import type { ServerConfig } from '@/core/types';

const KEY = 'dyarium.server.config';

export async function loadServerConfig(): Promise<ServerConfig | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ServerConfig;
    if (typeof parsed.baseUrl === 'string' && typeof parsed.token === 'string') {
      return parsed;
    }
    return null;
  } catch {
    // Sem SecureStore disponivel (ou valor corrompido): segue sem configuracao.
    return null;
  }
}

export async function saveServerConfig(config: ServerConfig): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(config));
}

export async function clearServerConfig(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
