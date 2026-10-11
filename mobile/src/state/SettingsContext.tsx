import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { DyariumApi, type FetchLike } from '@/core/api';
import type { ServerConfig } from '@/core/types';
import { clearServerConfig, loadServerConfig, saveServerConfig } from '@/services/secure';

const doFetch = globalThis.fetch as unknown as FetchLike;

export interface ConnectionResult {
  ok: boolean;
  version?: string;
  error?: string;
}

interface SettingsValue {
  config: ServerConfig | null;
  ready: boolean;
  /** Testa alcance (healthz) e token (version) sem salvar. */
  test(baseUrl: string, token: string): Promise<ConnectionResult>;
  /** Testa e, se ok, persiste no SecureStore. */
  save(baseUrl: string, token: string): Promise<ConnectionResult>;
  disconnect(): Promise<void>;
}

const SettingsContext = createContext<SettingsValue | null>(null);

function normalizeUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withScheme.replace(/\/+$/, '');
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    loadServerConfig()
      .then((loaded) => {
        if (!alive) return;
        setConfig(loaded);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const test = useCallback(async (baseUrl: string, token: string): Promise<ConnectionResult> => {
    const url = normalizeUrl(baseUrl);
    if (!url || !token.trim()) {
      return { ok: false, error: 'Informe a URL e o token do servidor.' };
    }
    const api = new DyariumApi({ baseUrl: url, token: token.trim() }, doFetch);
    try {
      await api.healthz();
    } catch {
      return { ok: false, error: 'Nao foi possivel alcancar o servidor. Verifique a URL e a rede.' };
    }
    try {
      const version = await api.version();
      return { ok: true, version: version.version };
    } catch {
      return { ok: false, error: 'O servidor respondeu, mas recusou o token.' };
    }
  }, []);

  const save = useCallback(
    async (baseUrl: string, token: string): Promise<ConnectionResult> => {
      const result = await test(baseUrl, token);
      if (result.ok) {
        const next: ServerConfig = { baseUrl: normalizeUrl(baseUrl), token: token.trim() };
        await saveServerConfig(next);
        setConfig(next);
      }
      return result;
    },
    [test],
  );

  const disconnect = useCallback(async () => {
    await clearServerConfig();
    setConfig(null);
  }, []);

  const value = useMemo<SettingsValue>(
    () => ({ config, ready, test, save, disconnect }),
    [config, ready, test, save, disconnect],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings deve ser usado dentro de SettingsProvider');
  return value;
}
