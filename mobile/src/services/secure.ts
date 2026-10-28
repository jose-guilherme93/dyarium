/**
 * Configuracao do servidor no SecureStore (Android Keystore / iOS Keychain).
 * O token nunca e gravado em texto puro no armazenamento comum.
 */

import * as SecureStore from 'expo-secure-store';

import {
  DEFAULT_TRANSCRIPTION_MODEL,
  type TranscriptionLanguage,
} from '@/core/transcription';
import { normalizeNoteOrder, type NoteOrder } from '@/core/noteOrder';
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

/**
 * Versao do blob de preferencias. Sobe quando uma chave muda de sentido: sem
 * ela nao da para distinguir instalacao nova de instalacao antiga, e a
 * migracao acabaria desligando o que o usuario ja tinha ligado.
 */
export const PREFS_VERSION = 2;

export interface Prefs {
  /** Versao do formato gravado; ausente = blob anterior aos tres interruptores. */
  version?: number;
  /** Tema visual do app. */
  theme?: ThemeName;
  /** O que o gesto de arrastar na lista faz. */
  swipeAction: SwipeAction;
  /** Ultimo ano usado na importacao (agiliza remessas do mesmo ano). */
  importYear?: number;
  /** Tipografia do editor de notas. */
  typography?: NoteTypography;
  /** Transcrever as notas (no aparelho ou no servidor, conforme abaixo). */
  transcriptionEnabled?: boolean;
  /** Analisar as notas (no aparelho ou no servidor, conforme abaixo). */
  analysisEnabled?: boolean;
  /** Processar no servidor em vez do aparelho. Exige servidor configurado. */
  serverProcessing?: boolean;
  /** @deprecated Substituido por `transcriptionEnabled` + `serverProcessing`. */
  localTranscription?: boolean;
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
  /** Ordem das notas: criacao mais recente ou mais antiga primeiro. */
  noteOrder?: NoteOrder;
}

const PREFS_KEY = 'dyarium.prefs';
const DEFAULT_PREFS: Prefs = {
  version: PREFS_VERSION,
  swipeAction: 'delete',
  transcriptionEnabled: false,
  analysisEnabled: false,
  serverProcessing: false,
  reviewTranscript: false,
  literalTranscript: false,
};

/**
 * Converte o blob antigo (`localTranscription`) nos tres interruptores.
 *
 * A regra preserva o comportamento de quem ja usava: escolha explicita de
 * aparelho continua no aparelho, escolha de servidor continua no servidor, e
 * quem nunca escolheu segue a mesma via de antes (servidor quando existe).
 */
async function migrateLegacyFlags(parsed: Partial<Prefs>): Promise<Prefs> {
  const explicitLocal = parsed.localTranscription === true;
  const explicitServer = parsed.localTranscription === false;
  let serverProcessing = false;
  if (explicitServer) serverProcessing = true;
  else if (!explicitLocal) serverProcessing = Boolean(await loadServerConfig());
  return {
    ...DEFAULT_PREFS,
    transcriptionEnabled: true,
    analysisEnabled: true,
    serverProcessing,
    version: PREFS_VERSION,
  };
}

export async function loadPrefs(): Promise<Prefs> {
  try {
    const raw = await SecureStore.getItemAsync(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    const legacy = parsed.version !== PREFS_VERSION;
    const migrated = legacy ? await migrateLegacyFlags(parsed) : null;
    return {
      version: PREFS_VERSION,
      theme: normalizeTheme(parsed.theme),
      swipeAction: parsed.swipeAction === 'archive' ? 'archive' : 'delete',
      importYear: typeof parsed.importYear === 'number' ? parsed.importYear : undefined,
      typography: parsed.typography ? normalizeTypography(parsed.typography) : undefined,
      transcriptionEnabled:
        migrated?.transcriptionEnabled ?? parsed.transcriptionEnabled === true,
      analysisEnabled: migrated?.analysisEnabled ?? parsed.analysisEnabled === true,
      serverProcessing: migrated?.serverProcessing ?? parsed.serverProcessing === true,
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
      noteOrder: normalizeNoteOrder(parsed.noteOrder),
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function savePrefs(prefs: Prefs): Promise<void> {
  // Grava sempre a versao atual: a migracao roda uma vez e nao volta a decidir
  // pelo usuario nas proximas aberturas.
  await SecureStore.setItemAsync(
    PREFS_KEY,
    JSON.stringify({ ...prefs, version: PREFS_VERSION }),
  );
}
