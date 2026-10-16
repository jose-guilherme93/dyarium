import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { DyariumApi, type FetchLike } from '@/core/api';
import {
  DEFAULT_TRANSCRIPTION_MODEL,
  type TranscriptionLanguage,
} from '@/core/transcription';
import {
  DEFAULT_TYPOGRAPHY,
  normalizeTypography,
  type NoteTypography,
} from '@/core/typography';
import type { ServerConfig } from '@/core/types';
import {
  clearServerConfig,
  loadPrefs,
  loadServerConfig,
  savePrefs,
  saveServerConfig,
  type Prefs,
  type SwipeAction,
} from '@/services/secure';

const doFetch = globalThis.fetch as unknown as FetchLike;

export interface ConnectionResult {
  ok: boolean;
  version?: string;
  error?: string;
}

interface SettingsValue {
  config: ServerConfig | null;
  ready: boolean;
  /** O que o gesto de arrastar na lista faz. */
  swipeAction: SwipeAction;
  setSwipeAction(action: SwipeAction): Promise<void>;
  /** Ultimo ano usado na importacao. */
  importYear?: number;
  setImportYear(year: number): Promise<void>;
  /** Tipografia do editor de notas. */
  typography: NoteTypography;
  setTypography(next: NoteTypography): Promise<void>;
  /** Transcrever no aparelho (quando ha modelo baixado). */
  localTranscription: boolean;
  setLocalTranscription(value: boolean): Promise<void>;
  /** Modelo de transcricao escolhido. */
  transcriptionModel: string;
  setTranscriptionModel(id: string): Promise<void>;
  /** Idioma da transcricao. */
  transcriptionLanguage: TranscriptionLanguage;
  setTranscriptionLanguage(value: TranscriptionLanguage): Promise<void>;
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
  const [swipeAction, setSwipeActionState] = useState<SwipeAction>('delete');
  const [importYear, setImportYearState] = useState<number | undefined>(undefined);
  const [typography, setTypographyState] = useState<NoteTypography>(DEFAULT_TYPOGRAPHY);
  const [localTranscription, setLocalTranscriptionState] = useState(true);
  const [transcriptionModel, setTranscriptionModelState] = useState(
    DEFAULT_TRANSCRIPTION_MODEL,
  );
  const [transcriptionLanguage, setTranscriptionLanguageState] =
    useState<TranscriptionLanguage>('pt');
  // Espelho das preferencias atuais, para gravar sempre o conjunto completo.
  const prefsRef = useRef<Prefs>({ swipeAction: 'delete', typography: DEFAULT_TYPOGRAPHY });

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
    loadPrefs()
      .then((prefs) => {
        if (!alive) return;
        prefsRef.current = prefs;
        setSwipeActionState(prefs.swipeAction);
        setImportYearState(prefs.importYear);
        setTypographyState(normalizeTypography(prefs.typography));
        setLocalTranscriptionState(prefs.localTranscription !== false);
        setTranscriptionModelState(prefs.transcriptionModel ?? DEFAULT_TRANSCRIPTION_MODEL);
        setTranscriptionLanguageState(prefs.transcriptionLanguage === 'auto' ? 'auto' : 'pt');
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const persistPrefs = useCallback(async (patch: Partial<Prefs>) => {
    const next = { ...prefsRef.current, ...patch };
    prefsRef.current = next;
    await savePrefs(next);
  }, []);

  const setSwipeAction = useCallback(
    async (action: SwipeAction) => {
      setSwipeActionState(action);
      await persistPrefs({ swipeAction: action });
    },
    [persistPrefs],
  );

  const setImportYear = useCallback(
    async (year: number) => {
      setImportYearState(year);
      await persistPrefs({ importYear: year });
    },
    [persistPrefs],
  );

  const setTypography = useCallback(
    async (next: NoteTypography) => {
      setTypographyState(next);
      await persistPrefs({ typography: next });
    },
    [persistPrefs],
  );

  const setLocalTranscription = useCallback(
    async (value: boolean) => {
      setLocalTranscriptionState(value);
      await persistPrefs({ localTranscription: value });
    },
    [persistPrefs],
  );

  const setTranscriptionModel = useCallback(
    async (id: string) => {
      setTranscriptionModelState(id);
      await persistPrefs({ transcriptionModel: id });
    },
    [persistPrefs],
  );

  const setTranscriptionLanguage = useCallback(
    async (value: TranscriptionLanguage) => {
      setTranscriptionLanguageState(value);
      await persistPrefs({ transcriptionLanguage: value });
    },
    [persistPrefs],
  );

  const test = useCallback(async (baseUrl: string, token: string): Promise<ConnectionResult> => {
    const url = normalizeUrl(baseUrl);
    if (!url || !token.trim()) {
      return { ok: false, error: 'Informe a URL e o token do servidor.' };
    }
    const api = new DyariumApi({ baseUrl: url, token: token.trim() }, doFetch);
    try {
      await api.healthz();
    } catch {
      return { ok: false, error: 'Não foi possível alcançar o servidor. Verifique a URL e a rede.' };
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
    () => ({
      config,
      ready,
      swipeAction,
      setSwipeAction,
      importYear,
      setImportYear,
      typography,
      setTypography,
      localTranscription,
      setLocalTranscription,
      transcriptionModel,
      setTranscriptionModel,
      transcriptionLanguage,
      setTranscriptionLanguage,
      test,
      save,
      disconnect,
    }),
    [
      config,
      ready,
      swipeAction,
      setSwipeAction,
      importYear,
      setImportYear,
      typography,
      setTypography,
      localTranscription,
      setLocalTranscription,
      transcriptionModel,
      setTranscriptionModel,
      transcriptionLanguage,
      setTranscriptionLanguage,
      test,
      save,
      disconnect,
    ],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings deve ser usado dentro de SettingsProvider');
  return value;
}
