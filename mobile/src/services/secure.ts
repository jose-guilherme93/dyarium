/**
 * Configuracao do servidor no SecureStore (Android Keystore / iOS Keychain).
 * O token nunca e gravado em texto puro no armazenamento comum.
 */

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { getAppFlag, setAppFlag } from '@/services/db';

import {
  type TranscriptionLanguage,
} from '@/core/transcription';
import {
  DEFAULT_ANALYSIS_PROVIDER,
  DEFAULT_DEEPGRAM_MODEL,
  normalizeAnalysisProvider,
  normalizeDeepgramModel,
  type TranscriptionOnlineProvider,
} from '@/core/providers';
import { normalizePlace, type ProcessingPlace } from '@/core/processing';
import { normalizeNoteOrder, type NoteOrder } from '@/core/noteOrder';
import { normalizeTypography, type NoteTypography } from '@/core/typography';
import { normalizeBackupFrequency, type BackupFrequency } from '@/core/backupSchedule';
import type { ServerConfig } from '@/core/types';
import { normalizeTheme, type ThemeName } from '@/theme/tokens';

const KEY = 'dyarium.server.config';

/**
 * O `expo-secure-store` nao tem implementacao web: no navegador a leitura
 * estoura e a gravacao falha calada. La o valor fica na `localStorage` desta
 * origem — fora de log, URL e backup, mas legivel por script da mesma origem,
 * que e o melhor que a plataforma oferece sem servidor.
 */
interface WebStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function webStore(): WebStore | null {
  return (globalThis as { localStorage?: WebStore }).localStorage ?? null;
}

async function readValue(key: string): Promise<string | null> {
  if (Platform.OS !== 'web') return SecureStore.getItemAsync(key);
  try {
    return webStore()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

async function writeValue(key: string, value: string): Promise<void> {
  if (Platform.OS !== 'web') {
    await SecureStore.setItemAsync(key, value);
    return;
  }
  try {
    webStore()?.setItem(key, value);
  } catch {
    // storage cheio ou bloqueado: a preferencia vale so nesta sessao
  }
}

async function deleteValue(key: string): Promise<void> {
  if (Platform.OS !== 'web') {
    await SecureStore.deleteItemAsync(key);
    return;
  }
  try {
    webStore()?.removeItem(key);
  } catch {
    // nada a apagar
  }
}

export async function loadServerConfig(): Promise<ServerConfig | null> {
  const servers = await loadServers();
  if (servers.length > 0) {
    const { baseUrl, token } = servers[0];
    return { baseUrl, token };
  }
  return loadLegacyServerConfig();
}

async function loadLegacyServerConfig(): Promise<ServerConfig | null> {
  try {
    const raw = await readValue(KEY);
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

/** Um ambiente conectado. O id e o `instance_id` do servidor, nunca a URL. */
export interface StoredServer extends ServerConfig {
  id: string;
  contract: string;
}

const SERVERS_KEY = 'dyarium.servers';

/**
 * Lista de ambientes conectados. O primeiro e o primario, usado pelos servicos
 * que ainda falam com um servidor so (transcricao, analise, metricas). Todos os
 * ambientes da lista participam da reconciliacao de notas.
 *
 * O formato antigo (um unico `dyarium.server.config`) e migrado em memoria e
 * gravado no formato novo no primeiro handshake, quando o id real e conhecido.
 */
export async function loadServers(): Promise<StoredServer[]> {
  try {
    const raw = await readValue(SERVERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const out: StoredServer[] = [];
        for (const value of parsed) {
          if (!value || typeof value !== 'object') continue;
          const item = value as Partial<StoredServer>;
          if (typeof item.baseUrl !== 'string' || typeof item.token !== 'string') continue;
          out.push({
            id: typeof item.id === 'string' ? item.id : '',
            baseUrl: item.baseUrl,
            token: item.token,
            label: typeof item.label === 'string' ? item.label : undefined,
            contract: typeof item.contract === 'string' ? item.contract : '',
          });
        }
        if (out.length > 0) return out;
      }
    }
  } catch {
    // valor corrompido: cai para o formato antigo
  }
  const legacy = await loadLegacyServerConfig();
  if (!legacy) return [];
  return [{ id: '', baseUrl: legacy.baseUrl, token: legacy.token, contract: '' }];
}

export async function saveServers(servers: StoredServer[]): Promise<void> {
  await writeValue(SERVERS_KEY, JSON.stringify(servers));
}

/** Insere ou atualiza um ambiente. O mais recente vira o primario. */
export async function upsertServer(server: StoredServer): Promise<StoredServer[]> {
  const current = await loadServers();
  const without = current.filter((item) => {
    if (server.id && item.id) return item.id !== server.id;
    return item.baseUrl !== server.baseUrl;
  });
  const next = [server, ...without];
  await saveServers(next);
  // Mantem o formato antigo alinhado ao primario, para um rollback nao abrir
  // sem servidor nenhum.
  await writeValue(KEY, JSON.stringify({ baseUrl: server.baseUrl, token: server.token }));
  return next;
}

export async function removeServer(id: string): Promise<StoredServer[]> {
  const current = await loadServers();
  const next = current.filter((item) => item.id !== id && item.baseUrl !== id);
  await saveServers(next);
  if (next.length === 0) {
    await deleteValue(KEY);
  } else {
    await writeValue(
      KEY,
      JSON.stringify({ baseUrl: next[0].baseUrl, token: next[0].token }),
    );
  }
  return next;
}

export async function saveServerConfig(config: ServerConfig): Promise<void> {
  await writeValue(KEY, JSON.stringify(config));
}

export async function clearServerConfig(): Promise<void> {
  await deleteValue(KEY);
}

const DEVICE_KEY = 'dyarium.device';

/** Identidade do aparelho para as metricas (id opaco + rotulo legivel). */
export interface DeviceIdentity {
  id: string;
  name: string;
}

export async function loadDeviceIdentity(): Promise<DeviceIdentity | null> {
  try {
    const raw = await readValue(DEVICE_KEY);
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
  await writeValue(DEVICE_KEY, JSON.stringify(identity));
}

/** Preferencias locais do app (nao sao segredo, mas ficam no mesmo cofre). */
export type SwipeAction = 'delete' | 'archive';

/**
 * Versao do blob de preferencias. Sobe quando uma chave muda de sentido: sem
 * ela nao da para distinguir instalacao nova de instalacao antiga, e a
 * migracao acabaria desligando o que o usuario ja tinha ligado.
 *
 * v3 troca os tres interruptores por um lugar por etapa (desligada, aparelho,
 * servidor ou online).
 */
export const PREFS_VERSION = 3;

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
  /** Onde a transcricao roda. */
  transcriptionPlace?: ProcessingPlace;
  /** Onde a analise roda. */
  analysisPlace?: ProcessingPlace;
  /** Provedor online de transcricao (o aparelho chama a API direto). */
  transcriptionProvider?: TranscriptionOnlineProvider;
  /** Modelo da Deepgram quando a transcricao e online. */
  transcriptionOnlineModel?: string;
  /** Preset do provedor de analise online. */
  analysisProvider?: string;
  /** URL base do provedor personalizado de analise. */
  analysisBaseUrl?: string;
  /** Modelo do provedor de analise online. */
  analysisOnlineModel?: string;
  /** @deprecated Lido na migracao v2; o lugar agora e `transcriptionPlace`. */
  transcriptionEnabled?: boolean;
  /** @deprecated Lido na migracao v2; o lugar agora e `analysisPlace`. */
  analysisEnabled?: boolean;
  /** @deprecated Lido na migracao v2; o lugar agora e por etapa. */
  serverProcessing?: boolean;
  /** @deprecated Substituido pelos tres interruptores na v2. */
  localTranscription?: boolean;
  /** Revisar a transcricao com a IA local antes de analisar. */
  reviewTranscript?: boolean;
  /** Manter hesitacoes e gagueira no texto revisado. */
  literalTranscript?: boolean;
  /** Id do modelo de transcricao escolhido (vazio = nenhum escolhido). */
  transcriptionModel?: string;
  /** Idioma da transcricao (pt fixo ou detectar). */
  transcriptionLanguage?: TranscriptionLanguage;
  /** Id do modelo de analise local escolhido. */
  analysisModel?: string;
  /** Menos threads na analise local: mais lento, menos CPU e bateria. */
  analysisLowPower?: boolean;
  /** Pasta escolhida para o backup local (uri). */
  backupFolder?: string;
  /** Rotina de backup local. */
  backupFrequency?: BackupFrequency;
  /** ISO da última execução automática bem-sucedida. */
  backupLastRunAt?: string;
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

/**
 * Preferencias moram no SQLite, nao no cofre.
 *
 * O SecureStore do Android amarra cada valor a uma chave do Keystore: quando a
 * chave e invalidada (troca de PIN, restauracao do sistema, atualizacao do
 * aparelho) todos os valores somem de uma vez. Preferencia de tema nao e
 * segredo; o cofre fica so com o token do servidor e com as chaves dos
 * provedores online. O blob antigo e lido uma vez e copiado para o SQLite, sem
 * perder a escolha de quem ja usava o app.
 */
async function readPrefsRaw(): Promise<string | null> {
  if (Platform.OS === 'web') return readValue(PREFS_KEY);
  // O banco pode estar abrindo (ou travado por uma migracao) no primeiro
  // render: nesse caso a leitura cai para o cofre antigo em vez de devolver os
  // padroes e parecer que o usuario nunca escolheu nada.
  const stored = await getAppFlag(PREFS_KEY).catch(() => null);
  if (stored) return stored;
  const legacy = await readValue(PREFS_KEY).catch(() => null);
  if (!legacy) return null;
  await setAppFlag(PREFS_KEY, legacy).catch(() => undefined);
  await deleteValue(PREFS_KEY).catch(() => undefined);
  return legacy;
}
const DEFAULT_PREFS: Prefs = {
  version: PREFS_VERSION,
  swipeAction: 'delete',
  backupFrequency: 'off',
  transcriptionPlace: 'off',
  analysisPlace: 'off',
  transcriptionProvider: 'deepgram',
  transcriptionOnlineModel: DEFAULT_DEEPGRAM_MODEL,
  analysisProvider: 'openrouter',
  analysisBaseUrl: '',
  analysisOnlineModel: '',
  reviewTranscript: false,
  literalTranscript: false,
};

/**
 * Converte os formatos antigos no lugar por etapa.
 *
 * A regra preserva o comportamento de quem ja usava: escolha explicita de
 * aparelho continua no aparelho, escolha de servidor continua no servidor, e
 * quem nunca escolheu segue a mesma via de antes (servidor quando existe).
 * Um modelo escolhido na v2 conta como escolha do aparelho, porque era assim
 * que o app se comportava depois do download.
 */
async function migratePlaces(parsed: Partial<Prefs>): Promise<{
  transcriptionPlace: ProcessingPlace;
  analysisPlace: ProcessingPlace;
}> {
  if ((parsed.version ?? 0) >= PREFS_VERSION) {
    return {
      transcriptionPlace: normalizePlace(parsed.transcriptionPlace),
      analysisPlace: normalizePlace(parsed.analysisPlace),
    };
  }
  const server = await loadServerConfig();
  if ((parsed.version ?? 0) === 0) {
    const explicitLocal = parsed.localTranscription === true;
    const explicitServer = parsed.localTranscription === false;
    const place: ProcessingPlace = explicitLocal
      ? 'device'
      : explicitServer
        ? 'server'
        : server
          ? 'server'
          : 'device';
    return { transcriptionPlace: place, analysisPlace: place };
  }
  const placeFor = (enabled: boolean | undefined, hadModel: boolean): ProcessingPlace => {
    if (parsed.serverProcessing === true && server) return 'server';
    if (enabled === true || hadModel) return 'device';
    return 'off';
  };
  return {
    transcriptionPlace: placeFor(parsed.transcriptionEnabled, parsed.transcriptionModel !== undefined),
    analysisPlace: placeFor(parsed.analysisEnabled, parsed.analysisModel !== undefined),
  };
}

export async function loadPrefs(): Promise<Prefs> {
  try {
    const raw = await readPrefsRaw();
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    const places = await migratePlaces(parsed);
    return {
      version: PREFS_VERSION,
      theme: normalizeTheme(parsed.theme),
      swipeAction: parsed.swipeAction === 'archive' ? 'archive' : 'delete',
      importYear: typeof parsed.importYear === 'number' ? parsed.importYear : undefined,
      typography: parsed.typography ? normalizeTypography(parsed.typography) : undefined,
      transcriptionPlace: places.transcriptionPlace,
      analysisPlace: places.analysisPlace,
      transcriptionProvider: 'deepgram',
      transcriptionOnlineModel: normalizeDeepgramModel(parsed.transcriptionOnlineModel),
      analysisProvider:
        parsed.analysisProvider === undefined
          ? DEFAULT_ANALYSIS_PROVIDER
          : normalizeAnalysisProvider(parsed.analysisProvider),
      analysisBaseUrl:
        typeof parsed.analysisBaseUrl === 'string' ? parsed.analysisBaseUrl.trim() : '',
      analysisOnlineModel:
        typeof parsed.analysisOnlineModel === 'string' ? parsed.analysisOnlineModel.trim() : '',
      reviewTranscript: parsed.reviewTranscript === true,
      literalTranscript: parsed.literalTranscript === true,
      // Sem modelo escolhido nao se inventa um: quem resolve e quem ve os
      // arquivos instalados, senao uma leitura ruim virava "sem modelo".
      transcriptionModel:
        typeof parsed.transcriptionModel === 'string' && parsed.transcriptionModel.trim() !== ''
          ? parsed.transcriptionModel
          : undefined,
      transcriptionLanguage: parsed.transcriptionLanguage === 'auto' ? 'auto' : 'pt',
      analysisModel:
        typeof parsed.analysisModel === 'string' ? parsed.analysisModel : undefined,
      backupFolder: typeof parsed.backupFolder === 'string' ? parsed.backupFolder : undefined,
      backupFrequency: normalizeBackupFrequency(parsed.backupFrequency),
      backupLastRunAt:
        typeof parsed.backupLastRunAt === 'string' ? parsed.backupLastRunAt : undefined,
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
  const raw = JSON.stringify({ ...prefs, version: PREFS_VERSION });
  if (Platform.OS === 'web') {
    await writeValue(PREFS_KEY, raw);
    return;
  }
  await setAppFlag(PREFS_KEY, raw);
}

/** Etapa com provedor online proprio. */
export type ProviderStage = 'transcription' | 'analysis';

const PROVIDER_KEY: Record<ProviderStage, string> = {
  transcription: 'dyarium.provider.transcription.key',
  analysis: 'dyarium.provider.analysis.key',
};

/**
 * Chave de um provedor online, no cofre do aparelho. Ela nunca entra no blob de
 * preferencias, no banco, em log ou em backup.
 */
export async function loadProviderKey(stage: ProviderStage): Promise<string | null> {
  const raw = await readValue(PROVIDER_KEY[stage]).catch(() => null);
  const key = (raw ?? '').trim();
  return key === '' ? null : key;
}

export async function saveProviderKey(stage: ProviderStage, key: string): Promise<void> {
  const value = key.trim();
  if (value === '') {
    await clearProviderKey(stage);
    return;
  }
  await writeValue(PROVIDER_KEY[stage], value);
}

export async function clearProviderKey(stage: ProviderStage): Promise<void> {
  await deleteValue(PROVIDER_KEY[stage]);
}

