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

/** Preferencias locais do app (nao sao segredo, mas ficam no mesmo cofre). */
export type SwipeAction = 'delete' | 'archive';

export interface Prefs {
  /** O que o gesto de arrastar na lista faz. */
  swipeAction: SwipeAction;
  /** Ultimo ano usado na importacao (agiliza remessas do mesmo ano). */
  importYear?: number;
  /** Tipografia do editor de notas. */
  typography?: NoteTypography;
  /** Transcrever no aparelho (desligado volta a usar o servidor). */
  localTranscription?: boolean;
  /** Id do modelo de transcricao escolhido. */
  transcriptionModel?: string;
  /** Idioma da transcricao (pt fixo ou detectar). */
  transcriptionLanguage?: TranscriptionLanguage;
}

const PREFS_KEY = 'dyarium.prefs';
const DEFAULT_PREFS: Prefs = { swipeAction: 'delete' };

export async function loadPrefs(): Promise<Prefs> {
  try {
    const raw = await SecureStore.getItemAsync(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      swipeAction: parsed.swipeAction === 'archive' ? 'archive' : 'delete',
      importYear: typeof parsed.importYear === 'number' ? parsed.importYear : undefined,
      typography: parsed.typography ? normalizeTypography(parsed.typography) : undefined,
      localTranscription:
        typeof parsed.localTranscription === 'boolean' ? parsed.localTranscription : undefined,
      transcriptionModel:
        typeof parsed.transcriptionModel === 'string'
          ? parsed.transcriptionModel
          : DEFAULT_TRANSCRIPTION_MODEL,
      transcriptionLanguage: parsed.transcriptionLanguage === 'auto' ? 'auto' : 'pt',
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function savePrefs(prefs: Prefs): Promise<void> {
  await SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(prefs));
}
