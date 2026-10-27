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
import { DEFAULT_ANALYSIS_MODEL } from '@/core/analysisModels';
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
import { bumpRender } from '@/dev/perf';
import {
  clearServerConfig,
  loadPrefs,
  loadServerConfig,
  savePrefs,
  saveServerConfig,
  type Prefs,
  type SwipeAction,
} from '@/services/secure';
import {
  DEFAULT_THEME,
  normalizeTheme,
  setActiveTheme,
  type ThemeName,
} from '@/theme/tokens';

const doFetch = globalThis.fetch as unknown as FetchLike;

export interface ConnectionResult {
  ok: boolean;
  version?: string;
  error?: string;
}

interface SettingsValue {
  config: ServerConfig | null;
  ready: boolean;
  /** Tema visual do app. */
  theme: ThemeName;
  setTheme(theme: ThemeName): Promise<void>;
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
  /** Aviso de transcricao e analise desligadas dispensado de vez. */
  transcriptionPromptDismissed: boolean;
  dismissTranscriptionPrompt(): Promise<void>;
  /** Modelo de transcricao escolhido. */
  transcriptionModel: string;
  setTranscriptionModel(id: string): Promise<void>;
  /** Idioma da transcricao. */
  transcriptionLanguage: TranscriptionLanguage;
  setTranscriptionLanguage(value: TranscriptionLanguage): Promise<void>;
  /** Modelo de analise local escolhido. */
  analysisModel: string;
  setAnalysisModel(id: string): Promise<void>;
  /** Menos threads na analise local: mais lento, menos CPU e bateria. */
  analysisLowPower: boolean;
  setAnalysisLowPower(value: boolean): Promise<void>;
  /** Pasta escolhida para o backup local (uri). */
  backupFolder?: string;
  setBackupFolder(uri: string): Promise<void>;
  /** Meta de palavras por semana (Painel). */
  weeklyWordGoal: number;
  setWeeklyWordGoal(value: number): Promise<void>;
  /** Lembretes de escrita (meta/sequencia). */
  writingReminders: boolean;
  setWritingReminders(value: boolean): Promise<void>;
  /** Hora do lembrete (0..23). */
  reminderHour: number;
  setReminderHour(value: number): Promise<void>;
  /** Ultimo marco de palavras comemorado (evita repetir). */
  celebratedWords: number;
  setCelebratedWords(value: number): Promise<void>;
  /** Ultima sequencia (dias) comemorada. */
  celebratedStreak: number;
  setCelebratedStreak(value: number): Promise<void>;
  /** Ultimo caderno aberto (local, nao sincronizado). */
  lastNotebookId?: string;
  setLastNotebookId(id: string): Promise<void>;
  /** Ordenar cadernos alfabeticamente em vez da ordem de criacao. */
  notebooksAlphabetical: boolean;
  setNotebooksAlphabetical(value: boolean): Promise<void>;
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
  bumpRender('SettingsProvider');
  const [config, setConfig] = useState<ServerConfig | null>(null);
  // "ready" significa configuracao E preferencias carregadas. A home e a nota
  // nao esperam: abrem com os padroes e atualizam quando o cofre responde.
  const [configReady, setConfigReady] = useState(false);
  const [prefsReady, setPrefsReady] = useState(false);
  const ready = configReady && prefsReady;
  const [theme, setThemeState] = useState<ThemeName>(DEFAULT_THEME);
  const [swipeAction, setSwipeActionState] = useState<SwipeAction>('delete');
  const [importYear, setImportYearState] = useState<number | undefined>(undefined);
  const [typography, setTypographyState] = useState<NoteTypography>(DEFAULT_TYPOGRAPHY);
  const [localTranscription, setLocalTranscriptionState] = useState(true);
  const [transcriptionPromptDismissed, setTranscriptionPromptDismissed] = useState(false);
  const [transcriptionModel, setTranscriptionModelState] = useState(
    DEFAULT_TRANSCRIPTION_MODEL,
  );
  const [transcriptionLanguage, setTranscriptionLanguageState] =
    useState<TranscriptionLanguage>('pt');
  const [analysisModel, setAnalysisModelState] = useState(DEFAULT_ANALYSIS_MODEL);
  const [analysisLowPower, setAnalysisLowPowerState] = useState(false);
  const [backupFolder, setBackupFolderState] = useState<string | undefined>(undefined);
  const [weeklyWordGoal, setWeeklyWordGoalState] = useState(1000);
  const [writingReminders, setWritingRemindersState] = useState(true);
  const [reminderHour, setReminderHourState] = useState(20);
  const [celebratedWords, setCelebratedWordsState] = useState(0);
  const [celebratedStreak, setCelebratedStreakState] = useState(0);
  const [lastNotebookId, setLastNotebookIdState] = useState<string | undefined>(undefined);
  const [notebooksAlphabetical, setNotebooksAlphabeticalState] = useState(false);
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
        if (alive) setConfigReady(true);
      });
    loadPrefs()
      .then((prefs) => {
        if (!alive) return;
        prefsRef.current = prefs;
        const loadedTheme = normalizeTheme(prefs.theme);
        // A paleta ativa precisa estar definida antes do estado que dispara o
        // render dos consumidores de `useTheme`.
        setActiveTheme(loadedTheme);
        setThemeState(loadedTheme);
        setSwipeActionState(prefs.swipeAction);
        setImportYearState(prefs.importYear);
        setTypographyState(normalizeTypography(prefs.typography));
        setLocalTranscriptionState(prefs.localTranscription !== false);
        setTranscriptionPromptDismissed(prefs.transcriptionPromptDismissed === true);
        setTranscriptionModelState(prefs.transcriptionModel ?? DEFAULT_TRANSCRIPTION_MODEL);
        setTranscriptionLanguageState(prefs.transcriptionLanguage === 'auto' ? 'auto' : 'pt');
        setAnalysisModelState(prefs.analysisModel ?? DEFAULT_ANALYSIS_MODEL);
        setAnalysisLowPowerState(prefs.analysisLowPower === true);
        setBackupFolderState(prefs.backupFolder);
        setWeeklyWordGoalState(prefs.weeklyWordGoal ?? 1000);
        setWritingRemindersState(prefs.writingReminders !== false);
        setReminderHourState(prefs.reminderHour ?? 20);
        setCelebratedWordsState(prefs.celebratedWords ?? 0);
        setCelebratedStreakState(prefs.celebratedStreak ?? 0);
        setLastNotebookIdState(prefs.lastNotebookId);
        setNotebooksAlphabeticalState(prefs.notebooksAlphabetical === true);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setPrefsReady(true);
      });
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

  const setTheme = useCallback(
    async (next: ThemeName) => {
      const themeName = normalizeTheme(next);
      // Atualiza a paleta antes do estado: os leitores (`colors`, estilos)
      // enxergam a nova cor ja no render disparado por `setThemeState`.
      setActiveTheme(themeName);
      setThemeState(themeName);
      await persistPrefs({ theme: themeName });
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

  const dismissTranscriptionPrompt = useCallback(async () => {
    setTranscriptionPromptDismissed(true);
    await persistPrefs({ transcriptionPromptDismissed: true });
  }, [persistPrefs]);

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

  const setAnalysisModel = useCallback(
    async (id: string) => {
      setAnalysisModelState(id);
      await persistPrefs({ analysisModel: id });
    },
    [persistPrefs],
  );

  const setAnalysisLowPower = useCallback(
    async (value: boolean) => {
      setAnalysisLowPowerState(value);
      await persistPrefs({ analysisLowPower: value });
    },
    [persistPrefs],
  );

  const setBackupFolder = useCallback(
    async (uri: string) => {
      setBackupFolderState(uri);
      await persistPrefs({ backupFolder: uri });
    },
    [persistPrefs],
  );

  const setWeeklyWordGoal = useCallback(
    async (value: number) => {
      const next = Math.max(0, Math.round(value));
      setWeeklyWordGoalState(next);
      await persistPrefs({ weeklyWordGoal: next });
    },
    [persistPrefs],
  );

  const setWritingReminders = useCallback(
    async (value: boolean) => {
      setWritingRemindersState(value);
      await persistPrefs({ writingReminders: value });
    },
    [persistPrefs],
  );

  const setReminderHour = useCallback(
    async (value: number) => {
      const next = Math.min(23, Math.max(0, Math.round(value)));
      setReminderHourState(next);
      await persistPrefs({ reminderHour: next });
    },
    [persistPrefs],
  );

  const setCelebratedWords = useCallback(
    async (value: number) => {
      setCelebratedWordsState(value);
      await persistPrefs({ celebratedWords: value });
    },
    [persistPrefs],
  );

  const setCelebratedStreak = useCallback(
    async (value: number) => {
      setCelebratedStreakState(value);
      await persistPrefs({ celebratedStreak: value });
    },
    [persistPrefs],
  );

  const setLastNotebookId = useCallback(
    async (id: string) => {
      setLastNotebookIdState(id);
      await persistPrefs({ lastNotebookId: id });
    },
    [persistPrefs],
  );

  const setNotebooksAlphabetical = useCallback(
    async (value: boolean) => {
      setNotebooksAlphabeticalState(value);
      await persistPrefs({ notebooksAlphabetical: value });
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
      theme,
      setTheme,
      swipeAction,
      setSwipeAction,
      importYear,
      setImportYear,
      typography,
      setTypography,
      localTranscription,
      setLocalTranscription,
      transcriptionPromptDismissed,
      dismissTranscriptionPrompt,
      transcriptionModel,
      setTranscriptionModel,
      transcriptionLanguage,
      setTranscriptionLanguage,
      analysisModel,
      setAnalysisModel,
      analysisLowPower,
      setAnalysisLowPower,
      backupFolder,
      setBackupFolder,
      weeklyWordGoal,
      setWeeklyWordGoal,
      writingReminders,
      setWritingReminders,
      reminderHour,
      setReminderHour,
      celebratedWords,
      setCelebratedWords,
      celebratedStreak,
      setCelebratedStreak,
      lastNotebookId,
      setLastNotebookId,
      notebooksAlphabetical,
      setNotebooksAlphabetical,
      test,
      save,
      disconnect,
    }),
    [
      config,
      ready,
      theme,
      setTheme,
      swipeAction,
      setSwipeAction,
      importYear,
      setImportYear,
      typography,
      setTypography,
      localTranscription,
      setLocalTranscription,
      transcriptionPromptDismissed,
      dismissTranscriptionPrompt,
      transcriptionModel,
      setTranscriptionModel,
      transcriptionLanguage,
      setTranscriptionLanguage,
      analysisModel,
      setAnalysisModel,
      analysisLowPower,
      setAnalysisLowPower,
      backupFolder,
      setBackupFolder,
      weeklyWordGoal,
      setWeeklyWordGoal,
      writingReminders,
      setWritingReminders,
      reminderHour,
      setReminderHour,
      celebratedWords,
      setCelebratedWords,
      celebratedStreak,
      setCelebratedStreak,
      lastNotebookId,
      setLastNotebookId,
      notebooksAlphabetical,
      setNotebooksAlphabetical,
      test,
      save,
      disconnect,
    ],
  );

  useEffect(() => {
    bumpRender('settings.value');
  }, [value]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
export function useSettings(): SettingsValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings deve ser usado dentro de SettingsProvider');
  return value;
}
