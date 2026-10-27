/**
 * Configuracao do servidor no SecureStore (Android Keystore / iOS Keychain).
 * O token nunca e gravado em texto puro no armazenamento comum.
 */

import * as SecureStore from 'expo-secure-store';

import {
  DEFAULT_TRANSCRIPTION_MODEL,
  type TranscriptionLanguage,
} from '@/core/transcription';
import { normalizeTypography, type NoteTypography } from '@/core/typography';
import type { ServerConfig } from '@/core/types';
import { normalizeTheme, type ThemeName } from '@/theme/tokens';

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

const DEVICE_KEY = 'dyarium.device';

/** Identidade do aparelho para as metricas (id opaco + rotulo legivel). */
export interface DeviceIdentity {
  id: string;
  name: string;
}

export async function loadDeviceIdentity(): Promise<DeviceIdentity | null> {
  try {
    const raw = await SecureStore.getItemAsync(DEVICE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DeviceIdentity>;
    if (typeof parsed.id === 'string' && parsed.id) {
      return { id: parsed.id, name: typeof parsed.name === 'string' ? parsed.name : '' };
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveDeviceIdentity(identity: DeviceIdentity): Promise<void> {
  await SecureStore.setItemAsync(DEVICE_KEY, JSON.stringify(identity));
}

/** Preferencias locais do app (nao sao segredo, mas ficam no mesmo cofre). */
export type SwipeAction = 'delete' | 'archive';

export interface Prefs {
  /** Tema visual do app. */
  theme?: ThemeName;
  /** O que o gesto de arrastar na lista faz. */
  swipeAction: SwipeAction;
  /** Ultimo ano usado na importacao (agiliza remessas do mesmo ano). */
  importYear?: number;
  /** Tipografia do editor de notas. */
  typography?: NoteTypography;
  /** Transcrever no aparelho (desligado volta a usar o servidor). */
  localTranscription?: boolean;
  /** Aviso de transcricao e analise desligadas ja dispensado pelo usuario. */
  transcriptionPromptDismissed?: boolean;
  /** Revisar a transcricao com a IA local antes de analisar. */
  reviewTranscript?: boolean;
  /** Manter hesitacoes e gagueira no texto revisado. */
  literalTranscript?: boolean;
  /** Id do modelo de transcricao escolhido. */
  transcriptionModel?: string;
  /** Idioma da transcricao (pt fixo ou detectar). */
  transcriptionLanguage?: TranscriptionLanguage;
  /** Id do modelo de analise local escolhido. */
  analysisModel?: string;
  /** Menos threads na analise local: mais lento, menos CPU e bateria. */
  analysisLowPower?: boolean;
  /** Pasta escolhida para o backup local (uri). */
  backupFolder?: string;
  /** Meta de palavras por semana (Painel). */
  weeklyWordGoal?: number;
  /** Lembretes de escrita (meta/sequencia). */
  writingReminders?: boolean;
  /** Hora do lembrete (0..23). */
  reminderHour?: number;
  /** Ultimo marco de palavras ja comemorado. */
  celebratedWords?: number;
  /** Ultima sequencia (dias) ja comemorada. */
  celebratedStreak?: number;
  /** Ultimo caderno aberto (navegacao local, nao sincronizada). */
  lastNotebookId?: string;
  /** Ordenar a lista de cadernos alfabeticamente (padrao: criacao). */
  notebooksAlphabetical?: boolean;
}

const PREFS_KEY = 'dyarium.prefs';
const DEFAULT_PREFS: Prefs = {
  swipeAction: 'delete',
  transcriptionPromptDismissed: false,
  reviewTranscript: false,
  literalTranscript: false,
};

export async function loadPrefs(): Promise<Prefs> {
  try {
    const raw = await SecureStore.getItemAsync(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      theme: normalizeTheme(parsed.theme),
      swipeAction: parsed.swipeAction === 'archive' ? 'archive' : 'delete',
      importYear: typeof parsed.importYear === 'number' ? parsed.importYear : undefined,
      typography: parsed.typography ? normalizeTypography(parsed.typography) : undefined,
      localTranscription:
        typeof parsed.localTranscription === 'boolean' ? parsed.localTranscription : undefined,
      transcriptionPromptDismissed: parsed.transcriptionPromptDismissed === true,
      reviewTranscript: parsed.reviewTranscript === true,
      literalTranscript: parsed.literalTranscript === true,
      transcriptionModel:
        typeof parsed.transcriptionModel === 'string'
          ? parsed.transcriptionModel
          : DEFAULT_TRANSCRIPTION_MODEL,
      transcriptionLanguage: parsed.transcriptionLanguage === 'auto' ? 'auto' : 'pt',
      analysisModel:
        typeof parsed.analysisModel === 'string' ? parsed.analysisModel : undefined,
      backupFolder: typeof parsed.backupFolder === 'string' ? parsed.backupFolder : undefined,
      weeklyWordGoal:
        typeof parsed.weeklyWordGoal === 'number' && parsed.weeklyWordGoal >= 0
          ? parsed.weeklyWordGoal
          : undefined,
      writingReminders:
        typeof parsed.writingReminders === 'boolean' ? parsed.writingReminders : undefined,
      reminderHour:
        typeof parsed.reminderHour === 'number' && parsed.reminderHour >= 0 && parsed.reminderHour <= 23
          ? parsed.reminderHour
          : undefined,
      celebratedWords:
        typeof parsed.celebratedWords === 'number' && parsed.celebratedWords >= 0
          ? parsed.celebratedWords
          : undefined,
      celebratedStreak:
        typeof parsed.celebratedStreak === 'number' && parsed.celebratedStreak >= 0
          ? parsed.celebratedStreak
          : undefined,
      lastNotebookId:
        typeof parsed.lastNotebookId === 'string' && parsed.lastNotebookId.trim()
          ? parsed.lastNotebookId
          : undefined,
      notebooksAlphabetical:
        typeof parsed.notebooksAlphabetical === 'boolean'
          ? parsed.notebooksAlphabetical
          : undefined,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function savePrefs(prefs: Prefs): Promise<void> {
  await SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(prefs));
}
