/**
 * Estado da tela do Drive: sessao do Google + sincronizacao do cofre.
 *
 * A tela nao fala com o Google nem com o Drive; ela so le este estado. A
 * sessao e opcional: sem client id, `configured` falso e a tela mostra o
 * caminho indisponivel; sem conta, o app continua inteiro no aparelho.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { VaultRestoreCounts, VaultStage, VaultSummary } from '@/services/driveVault';
import {
  openDriveVault,
  readVaultSummary,
  SUMMARY_FLAG,
  VAULT_ID_FLAG,
  VaultSyncError,
} from '@/services/driveVault';
import {
  connectDrive,
  disconnectDrive,
  driveProfile,
  driveSessionState,
  loadDriveSession,
  onDriveSessionChange,
  type DriveSessionState,
  type GoogleProfile,
} from '@/services/driveAuth';
import { driveConfigured } from '@/services/driveConfig';
import { useLibrary } from '@/state/LibraryContext';
import { setAppFlag } from '@/services/db';

export type DriveStage = 'auth' | VaultStage;

export interface DriveProgress {
  done: number;
  total: number;
}

export interface DriveValue {
  configured: boolean;
  status: DriveSessionState;
  busy: boolean;
  stage: DriveStage | null;
  progress: DriveProgress | null;
  summary: VaultSummary | null;
  profile: GoogleProfile | null;
  restored: VaultRestoreCounts | null;
  /** O Drive nao tinha `key.txt` e o cofre foi criado neste login. */
  created: boolean;
  error: string;
  connect(): Promise<void>;
  sync(): Promise<void>;
  disconnect(): Promise<void>;
  clearError(): void;
}

function describe(error: unknown): string {
  if (error instanceof VaultSyncError) {
    switch (error.kind) {
      case 'auth':
        return 'Sessão do Google vencida. Entrar de novo.';
      case 'config':
        return 'Google não configurado neste app.';
      case 'mismatch':
        return 'Este Drive tem outro cofre.';
      case 'limit':
        return 'Arquivo grande demais para o app.';
      case 'network':
        return 'Sem conexão com o Drive.';
      default:
        return 'Não foi possível abrir o cofre do Drive.';
    }
  }
  const message = error instanceof Error ? error.message : '';
  if (/cancelad|recusad/i.test(message)) return 'Login cancelado.';
  if (/janela|popup|respondeu/i.test(message)) return 'A janela do Google não abriu.';
  return 'Não foi possível conectar ao Drive.';
}

export function useDrive(): DriveValue {
  const { refresh, refreshNotebooks } = useLibrary();
  const [configured] = useState(() => driveConfigured());
  const [status, setStatus] = useState<DriveSessionState>(() => driveSessionState());
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<DriveStage | null>(null);
  const [progress, setProgress] = useState<DriveProgress | null>(null);
  const [summary, setSummary] = useState<VaultSummary | null>(null);
  const [profile, setProfile] = useState<GoogleProfile | null>(null);
  const [restored, setRestored] = useState<VaultRestoreCounts | null>(null);
  const [created, setCreated] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const running = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    void readVaultSummary().then((cached) => {
      if (alive.current && cached) setSummary(cached);
    });
  }, []);

  useEffect(() => {
    void loadDriveSession().then(() => {
      if (alive.current) {
        setStatus(driveSessionState());
        setProfile(driveProfile());
      }
    });
  }, []);

  useEffect(
    () =>
      onDriveSessionChange(() => {
        if (alive.current) {
          setStatus(driveSessionState());
          setProfile(driveProfile());
        }
      }),
    [],
  );

  const run = useCallback(
    async (login: boolean) => {
      if (busy || running.current) return;
      running.current = true;
      setBusy(true);
      setError('');
      setRestored(null);
      setProgress(null);
      setStage(login ? 'auth' : 'reading');
      try {
        if (login) await connectDrive();
        const opened = await openDriveVault({
          onStage: (next) => {
            if (alive.current) setStage(next);
          },
          onProgress: (next) => {
            if (alive.current) setProgress({ done: next.done, total: next.total });
          },
        });
        if (alive.current) {
          setSummary(opened.summary);
          setRestored(opened.restored);
          setCreated(opened.created);
          setStatus(driveSessionState());
          setProfile(driveProfile());
        }
        await refresh();
        await refreshNotebooks();
      } catch (caught) {
        if (alive.current) {
          setError(describe(caught));
          setStatus(driveSessionState());
          setProfile(driveProfile());
        }
      } finally {
        if (alive.current) {
          setBusy(false);
          setStage(null);
          setProgress(null);
        }
        running.current = false;
      }
    },
    [busy, refresh, refreshNotebooks],
  );

  const connect = useCallback(async () => {
    if (!configured) {
      setError('Google não configurado neste app.');
      return;
    }
    await run(true);
  }, [configured, run]);

  const sync = useCallback(async () => {
    await run(false);
  }, [run]);

  const disconnect = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      await disconnectDrive();
      setSummary(null);
      setProfile(null);
      setRestored(null);
      setCreated(false);
      await setAppFlag(SUMMARY_FLAG, '').catch(() => undefined);
      await setAppFlag(VAULT_ID_FLAG, '').catch(() => undefined);
    } catch {
      setError('Não foi possível desconectar.');
    } finally {
      if (alive.current) {
        setStatus(driveSessionState());
        setBusy(false);
      }
    }
  }, []);

  const clearError = useCallback(() => setError(''), []);

  return {
    configured,
    status,
    busy,
    stage,
    progress,
    summary,
    profile,
    restored,
    created,
    error,
    connect,
    sync,
    disconnect,
    clearError,
  };
}
