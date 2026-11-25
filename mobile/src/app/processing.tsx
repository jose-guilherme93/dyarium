import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';

import { Text } from '@/components/AppText';
import { KeySheet } from '@/components/KeySheet';
import { OptionSheet, type OptionItem } from '@/components/OptionSheet';
import { PlaceChoices } from '@/components/PlaceChoices';
import { Press } from '@/components/Press';
import { Screen } from '@/components/Screen';
import { ValueSheet } from '@/components/ValueSheet';
import { back, push } from '@/services/appNavigation';
import type { ServerSettings } from '@/core/api';
import { hasFinalTranscript } from '@/core/types';
import { displayTitle } from '@/core/title';
import type { ProcessingPlace } from '@/core/processing';
import {
  DEEPGRAM_MODELS,
  analysisProviderById,
  normalizeAnalysisProvider,
  resolveAnalysisBaseUrl,
} from '@/core/providers';
import {
  importProvidersFromServer,
  pushProvidersToServer,
  readServerSettings,
  updateServerSettings,
} from '@/services/serverProviders';
import { presetFromServer } from '@/core/providerSync';
import {
  clearProviderKey,
  loadProviderKey,
  saveProviderKey,
} from '@/services/secure';
import { installedModels } from '@/services/transcriptionModels';
import { installedAnalysisModels } from '@/services/analysisModels';
import { sendPendingTranscriptsToServer } from '@/services/transcripts';
import { transcribePendingLocally } from '@/services/localTranscription';
import { useLibrary } from '@/state/LibraryContext';
import { activityDestination } from '@/services/activity';
import { useActivities } from '@/state/useActivities';
import { useSettings } from '@/state/SettingsContext';
import { baseColors, fontSize, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

type Stage = 'transcription' | 'analysis';

type SheetState =
  | { kind: 'app-transcribe-model' }
  | { kind: 'app-transcribe-key' }
  | { kind: 'app-analysis-provider' }
  | { kind: 'app-analysis-model' }
  | { kind: 'app-analysis-model-custom' }
  | { kind: 'app-analysis-url' }
  | { kind: 'app-analysis-key' }
  | { kind: 'language' }
  | { kind: 'server-transcribe-provider' }
  | { kind: 'server-transcribe-model' }
  | { kind: 'server-transcribe-key' }
  | { kind: 'server-analysis-provider' }
  | { kind: 'server-analysis-model' }
  | { kind: 'server-analysis-url' }
  | { kind: 'server-analysis-key' }
  | { kind: 'server-analysis-themes' }
  | null;

function stageLabel(stage: Stage): string {
  return stage === 'transcription' ? 'Transcrição' : 'Análise';
}

export default function ProcessingScreen() {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();
  const settings = useSettings();
  const library = useLibrary();

  const {
    config,
    transcriptionPlace,
    setTranscriptionPlace,
    analysisPlace,
    setAnalysisPlace,
    transcriptionOnlineModel,
    setTranscriptionOnlineModel,
    analysisProvider,
    setAnalysisProvider,
    analysisBaseUrl,
    setAnalysisBaseUrl,
    analysisOnlineModel,
    setAnalysisOnlineModel,
    transcriptionLanguage,
    setTranscriptionLanguage,
    reviewTranscript,
    setReviewTranscript,
    setLiteralTranscript,
    transcriptionModel,
    analysisModel,
  } = settings;

  const [server, setServer] = useState<ServerSettings | null>(null);
  const [keys, setKeys] = useState({ transcription: false, analysis: false });
  const [sheet, setSheet] = useState<SheetState>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const [snapshot, transcriptionKey, analysisKey] = await Promise.all([
      readServerSettings(),
      loadProviderKey('transcription'),
      loadProviderKey('analysis'),
    ]);
    setServer(snapshot);
    setKeys({ transcription: Boolean(transcriptionKey), analysis: Boolean(analysisKey) });
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const pending = library.recordings.filter(
    (recording) => Boolean(recording.filePath) && !recording.deletedAt && !hasFinalTranscript(recording),
  );
  const activities = useActivities();
  const runningWork = activities.filter(
    (activity) =>
      activity.status === 'running' &&
      (activity.kind === 'transcription' || activity.kind === 'analysis'),
  );
  const runningIds = new Set(
    runningWork
      .map((activity) => activityDestination(activity)?.noteId)
      .filter((noteId): noteId is string => Boolean(noteId)),
  );
  const waitingNotes = pending.filter((recording) => !runningIds.has(recording.title));

  const deviceReady = (stage: Stage) =>
    stage === 'transcription'
      ? installedModels().length > 0
      : installedAnalysisModels().length > 0;

  const preferredPlace = (stage: Stage): Exclude<ProcessingPlace, 'off'> => {
    if (deviceReady(stage)) return 'device';
    if (config) return 'server';
    if (stage === 'transcription' ? keys.transcription : keys.analysis) return 'online';
    return 'device';
  };

  const toggleStage = async (stage: Stage, on: boolean) => {
    if (stage === 'transcription') {
      await setTranscriptionPlace(on ? preferredPlace(stage) : 'off');
    } else {
      await setAnalysisPlace(on ? preferredPlace(stage) : 'off');
    }
  };

  const changePlace = async (stage: Stage, place: Exclude<ProcessingPlace, 'off'>) => {
    if (place === 'server' && !config) {
      setNotice('Conecte um servidor para processar lá.');
      return;
    }
    if (stage === 'transcription') await setTranscriptionPlace(place);
    else await setAnalysisPlace(place);
    setNotice('');
  };

  const importFromServer = async () => {
    if (!config || busy) return;
    setBusy(true);
    try {
      const imported = await importProvidersFromServer();
      if (!imported) {
        setNotice('O servidor não respondeu.');
        return;
      }
      await setTranscriptionOnlineModel(imported.transcriptionOnlineModel);
      await setAnalysisProvider(imported.analysisProvider);
      await setAnalysisBaseUrl(imported.analysisBaseUrl);
      await setAnalysisOnlineModel(imported.analysisOnlineModel);
      await setTranscriptionLanguage(imported.transcriptionLanguage);
      await setReviewTranscript(imported.reviewTranscript);
      await setLiteralTranscript(imported.literalTranscript);
      setNotice('Provedores e modelos trazidos do servidor. Chaves ficam lá.');
    } finally {
      setBusy(false);
    }
  };

  const sendToServer = async () => {
    if (!config || busy) return;
    setBusy(true);
    try {
      const ok = await pushProvidersToServer();
      setNotice(ok ? 'Configuração enviada ao servidor.' : 'O servidor não aceitou a configuração.');
      if (ok) await reload();
    } finally {
      setBusy(false);
    }
  };

  const serverWrite = async (patch: Record<string, unknown>) => {
    const ok = await updateServerSettings(patch);
    if (ok) await reload();
    else setNotice('O servidor não aceitou a mudança.');
    return ok;
  };

  const pendingAction = async () => {
    if (busy || pending.length === 0 || transcriptionPlace === 'off') return;
    setBusy(true);
    try {
      if (transcriptionPlace === 'server') {
        const result = await sendPendingTranscriptsToServer();
        setNotice(`${result.sent} nota(s) enviadas ao servidor.`);
        await library.refresh();
      } else {
        void transcribePendingLocally().catch(() => undefined);
        setNotice('Transcrição iniciada no aparelho.');
      }
    } finally {
      setBusy(false);
    }
  };

  const row = (
    label: string,
    value: ReactNode,
    onPress?: () => void,
    options: { last?: boolean; muted?: boolean; hint?: string } = {},
  ) => {
    const content = (
      <View style={[styles.row, options.last && styles.rowLast]}>
        <View style={styles.rowTexts}>
          <Text style={[styles.rowLabel, options.muted && styles.rowLabelMuted]}>{label}</Text>
          {options.hint ? <Text style={styles.rowHint}>{options.hint}</Text> : null}
        </View>
        <View style={styles.rowTrailing}>{value}</View>
      </View>
    );
    if (!onPress) {
      return (
        <View
          key={label}
          accessible
          accessibilityLabel={label}
          accessibilityState={{ disabled: true }}
        >
          {content}
        </View>
      );
    }
    return (
      <Press
        key={label}
        onPress={onPress}
        style={styles.rowLine}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        {content}
        <Ionicons name="chevron-forward" size={15} color={colors.textTertiary} />
      </Press>
    );
  };

  const section = (stage: Stage, place: ProcessingPlace, content: ReactNode) => (
    <View>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionLabel}>{stageLabel(stage)}</Text>
        <Switch
          value={place !== 'off'}
          onValueChange={(on) => void toggleStage(stage, on)}
          trackColor={{ true: colors.accent }}
          accessibilityLabel={`Ligar ${stageLabel(stage).toLowerCase()}`}
        />
      </View>
      <View style={styles.placeRow}>
        <PlaceChoices
          value={place}
          label={`Onde roda a ${stageLabel(stage).toLowerCase()}`}
          onChange={(next) => void changePlace(stage, next)}
          disabled={place === 'off'}
        />
      </View>
      {place === 'off' ? (
        <Text style={styles.offText}>Notas novas não entram na fila.</Text>
      ) : (
        content
      )}
    </View>
  );

  const transcribeDevice =
    transcriptionPlace === 'device'
      ? [
          row(
            'Modelo',
            <Text style={styles.rowValue}>
              {installedModels().find((model) => model.id === transcriptionModel)?.id ??
                (installedModels()[0]?.id ?? 'nenhum')}
            </Text>,
            () => push('/transcription'),
          ),
          row(
            'Idioma',
            <Text style={styles.rowValue}>{transcriptionLanguage === 'auto' ? 'Detectar' : 'Português'}</Text>,
            () => setSheet({ kind: 'language' }),
          ),
        ]
      : null;

  const transcribeOnline =
    transcriptionPlace === 'online'
      ? [
          row('Provedor', <Text style={styles.rowValue}>Deepgram</Text>),
          row(
            'Modelo',
            <Text style={styles.rowValue}>{transcriptionOnlineModel}</Text>,
            () => setSheet({ kind: 'app-transcribe-model' }),
          ),
          row(
            'Chave',
            <Text style={styles.rowValue}>{keys.transcription ? 'definida · cofre' : 'ausente'}</Text>,
            () => setSheet({ kind: 'app-transcribe-key' }),
          ),
        ]
      : null;

  const transcribeServer =
    transcriptionPlace === 'server'
      ? server === null
        ? [
            row(
              'Servidor',
              <Text style={styles.rowValue}>sem resposta</Text>,
              () => void reload(),
              { last: true },
            ),
          ]
        : [
          row(
            'Provedor',
            <Text style={styles.rowValue}>
              {server?.transcribe_provider === 'deepgram' ? 'Deepgram' : 'Whisper'}
            </Text>,
            () => setSheet({ kind: 'server-transcribe-provider' }),
          ),
          row(
            'Modelo',
            <Text style={styles.rowValue}>
              {server?.transcribe_provider === 'deepgram'
                ? server?.deepgram_model || 'nova-2'
                : server?.whisper_model || 'padrão'}
            </Text>,
            server?.transcribe_provider === 'deepgram'
              ? () => setSheet({ kind: 'server-transcribe-model' })
              : undefined,
          ),
          ...(server?.transcribe_provider === 'deepgram'
            ? [
                row(
                  'Chave',
                  <Text style={styles.rowValue}>
                    {server?.deepgram_api_key_set ? 'no servidor' : 'ausente'}
                  </Text>,
                  () => setSheet({ kind: 'server-transcribe-key' }),
                ),
              ]
            : []),
          row(
            'Idioma',
            <Text style={styles.rowValue}>{server?.whisper_language || 'Detectar'}</Text>,
            () => setSheet({ kind: 'language' }),
          ),
          row(
            'Corte de silêncio',
            <Switch
              value={server?.trim_silence === true}
              onValueChange={(value) => void serverWrite({ trim_silence: value })}
              trackColor={{ true: colors.accent }}
              accessibilityLabel="Corte de silêncio no servidor"
            />,
            undefined,
            { last: true },
          ),
        ]
      : null;

  const analysisDevice =
    analysisPlace === 'device'
      ? [
          row(
            'Modelo',
            <Text style={styles.rowValue}>
              {installedAnalysisModels().find((model) => model.id === analysisModel)?.id ??
                (installedAnalysisModels()[0]?.id ?? 'nenhum')}
            </Text>,
            () => push('/transcription'),
          ),
          row(
            'Revisar transcrição',
            <Switch
              value={reviewTranscript}
              onValueChange={(value) => void setReviewTranscript(value)}
              trackColor={{ true: colors.accent }}
              accessibilityLabel="Revisar transcrição com IA"
            />,
            undefined,
            { last: true },
          ),
        ]
      : null;

  const preset = analysisProviderById(analysisProvider);
  const analysisOnline =
    analysisPlace === 'online'
      ? [
          row(
            'Provedor',
            <Text style={styles.rowValue}>{preset?.short ?? 'Personalizado'}</Text>,
            () => setSheet({ kind: 'app-analysis-provider' }),
          ),
          ...(analysisProvider === 'custom'
            ? [
                row(
                  'URL',
                  <Text style={styles.rowValue} numberOfLines={1}>
                    {analysisBaseUrl || 'definir'}
                  </Text>,
                  () => setSheet({ kind: 'app-analysis-url' }),
                ),
              ]
            : []),
          row(
            'Modelo',
            <Text style={styles.rowValue}>{analysisOnlineModel || 'definir'}</Text>,
            () => setSheet({ kind: 'app-analysis-model' }),
          ),
          row(
            'Chave',
            <Text style={styles.rowValue}>{keys.analysis ? 'definida · cofre' : 'ausente'}</Text>,
            () => setSheet({ kind: 'app-analysis-key' }),
            { last: true },
          ),
        ]
      : null;

  const analysisServer =
    analysisPlace === 'server'
      ? server === null
        ? [
            row(
              'Servidor',
              <Text style={styles.rowValue}>sem resposta</Text>,
              () => void reload(),
              { last: true },
            ),
          ]
        : [
          row(
            'Provedor',
            <Text style={styles.rowValue}>{server?.analyze_provider || 'não definido'}</Text>,
            () => setSheet({ kind: 'server-analysis-provider' }),
          ),
          row(
            'Modelo',
            <Text style={styles.rowValue}>{server?.analyze_model || 'não definido'}</Text>,
            () => setSheet({ kind: 'server-analysis-model' }),
          ),
          row(
            'Chave',
            <Text style={styles.rowValue}>{server?.analyze_api_key_set ? 'no servidor' : 'ausente'}</Text>,
            () => setSheet({ kind: 'server-analysis-key' }),
          ),
          row(
            'Temas',
            <Text style={styles.rowValue} numberOfLines={1}>
              {server?.analysis_themes || 'padrão'}
            </Text>,
            () => setSheet({ kind: 'server-analysis-themes' }),
          ),
          row(
            'Análise ligada no servidor',
            <Switch
              value={server?.analyze_enabled === true}
              onValueChange={(value) => void serverWrite({ analyze_enabled: value })}
              trackColor={{ true: colors.accent }}
              accessibilityLabel="Análise ligada no servidor"
            />,
            undefined,
            { last: true },
          ),
        ]
      : null;

  const languageOptions: OptionItem[] = [
    { id: 'pt', label: 'Português' },
    { id: 'auto', label: 'Detectar automaticamente' },
    { id: 'en', label: 'Inglês' },
    { id: 'es', label: 'Espanhol' },
  ];

  const analysisProviderOptions: OptionItem[] = [
    'openrouter',
    'groq',
    'google',
    'deepseek',
    'mistral',
    'xai',
    'custom',
  ]
    .map((id) => analysisProviderById(id))
    .filter((value): value is NonNullable<typeof value> => Boolean(value))
    .map((value) => ({
      id: value.id,
      label: value.label,
      hint: value.id === 'custom' ? 'URL e modelo próprios' : value.model,
    }));

  const analysisModelOptions: OptionItem[] = [
    ...(preset?.models ?? []).map((model) => ({ id: model, label: model })),
    { id: '__custom__', label: 'Outro modelo' },
  ];

  return (
    <Screen>
      <View style={styles.header}>
        <Press onPress={() => back()} style={styles.iconButton} accessibilityLabel="Voltar">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Press>
        <Text style={styles.headerTitle}>Processamento</Text>
        <View style={styles.iconButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {section(
          'transcription',
          transcriptionPlace,
          <View>
            {transcribeDevice}
            {transcribeOnline}
            {transcribeServer}
          </View>,
        )}

        {section(
          'analysis',
          analysisPlace,
          <View>
            {analysisDevice}
            {analysisOnline}
            {analysisServer}
          </View>,
        )}

        <View style={styles.sectionHead}>
          <Text style={styles.sectionLabel}>Entre ambientes</Text>
          <Text style={styles.sectionMeta}>{config ? 'mesma conta' : 'sem servidor'}</Text>
        </View>
        {row(
          'Importar do servidor',
          null,
          config ? () => void importFromServer() : undefined,
          { muted: !config, hint: 'provedores e modelos' },
        )}
        {row(
          'Enviar para o servidor',
          null,
          config ? () => void sendToServer() : undefined,
          { muted: !config, hint: 'este aparelho → web', last: true },
        )}
        <View style={styles.lockRow}>
          <Ionicons name="lock-closed-outline" size={12} color={colors.textTertiary} />
          <Text style={styles.lockText}>Chaves ficam no ambiente que as digitou</Text>
        </View>

        <View style={styles.sectionHead}>
          <Text style={styles.sectionLabel}>Fila</Text>
          <Text style={styles.sectionMeta}>
            {pending.length} {pending.length === 1 ? 'nota' : 'notas'}
          </Text>
        </View>
        {runningWork.map((activity) => {
          const percent =
            activity.progress !== undefined ? Math.round(activity.progress) : null;
          return (
            <View key={activity.id} style={styles.queueItem}>
              <View style={styles.queueTexts}>
                <Text style={styles.queueTitle} numberOfLines={1}>
                  {activity.title}
                </Text>
                <Text style={styles.queueDetail} numberOfLines={1}>
                  {activity.detail ??
                    (activity.kind === 'analysis' ? 'Analisando' : 'Transcrevendo')}
                </Text>
                {percent !== null ? (
                  <View style={styles.queueTrack}>
                    <View style={[styles.queueFill, { width: `${percent}%` }]} />
                  </View>
                ) : null}
              </View>
              <Text style={styles.queuePercent}>{percent !== null ? `${percent}%` : '—'}</Text>
              {activity.stop ? (
                <Press
                  onPress={() => void activity.stop?.run()}
                  accessibilityRole="button"
                  accessibilityLabel={activity.stop.label}
                >
                  <Text style={styles.queueStop}>{activity.stop.label}</Text>
                </Press>
              ) : null}
            </View>
          );
        })}
        {waitingNotes.slice(0, 3).map((recording) => (
          <View key={recording.id} style={styles.queueItem}>
            <View style={styles.queueTexts}>
              <Text style={styles.queueTitle} numberOfLines={1}>
                {displayTitle(recording)}
              </Text>
              <Text style={styles.queueDetail}>
                {recording.transcriptOrigin === 'server' ? 'No servidor' : 'Aguardando a vez'}
              </Text>
            </View>
            <Text style={styles.queuePercent}>—</Text>
          </View>
        ))}
        {runningWork.length === 0 && pending.length === 0 ? (
          <Text style={styles.queueEmpty}>Nada na fila.</Text>
        ) : null}
        <Press
          style={styles.queueAction}
          onPress={() => void pendingAction()}
          disabled={pending.length === 0 || busy || transcriptionPlace === 'off'}
          accessibilityRole="button"
          accessibilityLabel={
            transcriptionPlace === 'server'
              ? 'Enviar pendentes ao servidor'
              : transcriptionPlace === 'off'
                ? 'Transcrição desligada'
                : 'Transcrever pendentes'
          }
        >
          <Text
            style={[
              styles.queueText,
              (pending.length === 0 || busy || transcriptionPlace === 'off') &&
                styles.queueTextMuted,
            ]}
          >
            {transcriptionPlace === 'server'
              ? 'Enviar pendentes ao servidor'
              : transcriptionPlace === 'off'
                ? 'Transcrição desligada'
                : 'Transcrever pendentes'}
          </Text>
        </Press>

        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        <View style={styles.end} />
      </ScrollView>

      <OptionSheet
        visible={sheet?.kind === 'language'}
        title="Idioma do áudio"
        options={languageOptions}
        selected={
          transcriptionPlace === 'server'
            ? server?.whisper_language || 'auto'
            : transcriptionLanguage
        }
        onClose={() => setSheet(null)}
        onSelect={(id) => {
          if (transcriptionPlace === 'server') {
            void serverWrite({ whisper_language: id === 'auto' ? '' : id });
          } else {
            void setTranscriptionLanguage(id === 'auto' ? 'auto' : 'pt');
          }
        }}
      />

      <OptionSheet
        visible={sheet?.kind === 'app-transcribe-model'}
        title="Modelo da Deepgram"
        options={DEEPGRAM_MODELS.map((model) => ({ id: model, label: model }))}
        selected={transcriptionOnlineModel}
        onClose={() => setSheet(null)}
        onSelect={(id) => void setTranscriptionOnlineModel(id)}
      />

      <KeySheet
        visible={sheet?.kind === 'app-transcribe-key'}
        title="Chave da Deepgram"
        placeholder="cole a chave da Deepgram"
        hasKey={keys.transcription}
        hint="Fica no cofre deste aparelho. O servidor não recebe uma cópia."
        onClose={() => setSheet(null)}
        onSave={async (key) => {
          await saveProviderKey('transcription', key);
          await reload();
        }}
        onClear={async () => {
          await clearProviderKey('transcription');
          await reload();
        }}
      />

      <OptionSheet
        visible={sheet?.kind === 'app-analysis-provider'}
        title="Provedor de análise"
        options={analysisProviderOptions}
        selected={normalizeAnalysisProvider(analysisProvider)}
        onClose={() => setSheet(null)}
        onSelect={(id) => {
          void setAnalysisProvider(id);
          const value = analysisProviderById(id);
          if (value && value.model) void setAnalysisOnlineModel(value.model);
        }}
      />

      <OptionSheet
        visible={sheet?.kind === 'app-analysis-model'}
        title="Modelo de análise"
        options={analysisModelOptions}
        selected={analysisOnlineModel}
        onClose={() => setSheet(null)}
        onSelect={(id) => {
          if (id === '__custom__') setSheet({ kind: 'app-analysis-model-custom' });
          else void setAnalysisOnlineModel(id);
        }}
      />

      <ValueSheet
        visible={sheet?.kind === 'app-analysis-model-custom'}
        title="Modelo de análise"
        placeholder="nome do modelo"
        initial={analysisOnlineModel}
        onClose={() => setSheet(null)}
        onSave={(value) => setAnalysisOnlineModel(value)}
      />

      <ValueSheet
        visible={sheet?.kind === 'app-analysis-url'}
        title="URL do provedor"
        placeholder="https://.../v1"
        initial={analysisBaseUrl}
        keyboardType="url"
        onClose={() => setSheet(null)}
        onSave={(value) => setAnalysisBaseUrl(value)}
      />

      <KeySheet
        visible={sheet?.kind === 'app-analysis-key'}
        title="Chave do provedor"
        placeholder="cole a chave da API"
        hasKey={keys.analysis}
        hint="Fica no cofre deste aparelho. O servidor não recebe uma cópia."
        onClose={() => setSheet(null)}
        onSave={async (key) => {
          await saveProviderKey('analysis', key);
          await reload();
        }}
        onClear={async () => {
          await clearProviderKey('analysis');
          await reload();
        }}
      />

      <OptionSheet
        visible={sheet?.kind === 'server-transcribe-provider'}
        title="Provedor no servidor"
        options={[
          { id: 'whisper', label: 'Whisper', hint: 'roda no servidor' },
          { id: 'deepgram', label: 'Deepgram', hint: 'chave e modelo na conta' },
        ]}
        selected={server?.transcribe_provider ?? 'whisper'}
        onClose={() => setSheet(null)}
        onSelect={(id) => void serverWrite({ transcribe_provider: id })}
      />

      <OptionSheet
        visible={sheet?.kind === 'server-transcribe-model'}
        title="Modelo da Deepgram no servidor"
        options={DEEPGRAM_MODELS.map((model) => ({ id: model, label: model }))}
        selected={server?.deepgram_model ?? 'nova-2'}
        onClose={() => setSheet(null)}
        onSelect={(id) => void serverWrite({ deepgram_model: id })}
      />

      <KeySheet
        visible={sheet?.kind === 'server-transcribe-key'}
        title="Chave da Deepgram no servidor"
        placeholder="cole a chave da Deepgram"
        hasKey={server?.deepgram_api_key_set === true}
        hint="A chave vai para a conta do servidor; o app não guarda cópia."
        onClose={() => setSheet(null)}
        onSave={(key) => void serverWrite({ deepgram_api_key: key })}
        onClear={() => void serverWrite({ deepgram_api_key: '' })}
      />

      <OptionSheet
        visible={sheet?.kind === 'server-analysis-provider'}
        title="Provedor de análise no servidor"
        options={analysisProviderOptions}
        selected={
          server
            ? presetFromServer(
                server.analyze_provider,
                server.analyze_base_url,
                server.analyze_local_runtime,
              )
            : 'custom'
        }
        onClose={() => setSheet(null)}
        onSelect={(id) => {
          const value = analysisProviderById(id);
          void serverWrite({
            analyze_provider: 'openai',
            analyze_base_url: resolveAnalysisBaseUrl(id, ''),
            analyze_model: value?.model || '',
          });
        }}
      />

      <ValueSheet
        visible={sheet?.kind === 'server-analysis-model'}
        title="Modelo no servidor"
        placeholder="nome do modelo"
        initial={server?.analyze_model ?? ''}
        onClose={() => setSheet(null)}
        onSave={(value) => void serverWrite({ analyze_model: value })}
      />

      <KeySheet
        visible={sheet?.kind === 'server-analysis-key'}
        title="Chave de análise no servidor"
        placeholder="cole a chave da API"
        hasKey={server?.analyze_api_key_set === true}
        hint="A chave vai para a conta do servidor; o app não guarda cópia."
        onClose={() => setSheet(null)}
        onSave={(key) => void serverWrite({ analyze_api_key: key })}
        onClear={() => void serverWrite({ analyze_api_key: '' })}
      />

      <ValueSheet
        visible={sheet?.kind === 'server-analysis-themes'}
        title="Temas da análise"
        placeholder="familia, trabalho, saúde"
        initial={server?.analysis_themes ?? ''}
        onClose={() => setSheet(null)}
        onSave={(value) => void serverWrite({ analysis_themes: value })}
      />
    </Screen>
  );
}

const baseStyles = defineStyles({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: baseColors.text, fontSize: fontSize.lg, fontWeight: '700' },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 40,
    marginTop: spacing.lg,
  },
  sectionLabel: {
    color: baseColors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.9,
  },
  sectionMeta: { color: baseColors.textTertiary, fontSize: fontSize.xs, fontWeight: '500' },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 40,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: baseColors.border,
  },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 46,
    paddingVertical: spacing.sm,
    flex: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: baseColors.border,
  },
  rowLast: { borderBottomWidth: 0 },
  rowTexts: { flex: 1, gap: 2 },
  rowLabel: { color: baseColors.text, fontSize: fontSize.md, fontWeight: '500' },
  rowLabelMuted: { color: baseColors.textTertiary },
  rowHint: { color: baseColors.textTertiary, fontSize: fontSize.xs },
  rowTrailing: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowValue: { color: baseColors.textSecondary, fontSize: fontSize.sm, fontWeight: '500' },
  offText: { color: baseColors.textTertiary, fontSize: fontSize.sm, paddingVertical: spacing.sm },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: spacing.sm },
  lockText: { color: baseColors.textTertiary, fontSize: fontSize.xs },
  queueItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: baseColors.border,
  },
  queueTexts: { flex: 1, gap: 3 },
  queueTitle: { color: baseColors.text, fontSize: fontSize.md, fontWeight: '500' },
  queueDetail: { color: baseColors.textSecondary, fontSize: fontSize.xs },
  queuePercent: {
    color: baseColors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  queueStop: { color: baseColors.textTertiary, fontSize: fontSize.xs, fontWeight: '600' },
  queueTrack: {
    height: 2,
    borderRadius: 2,
    backgroundColor: baseColors.border,
    overflow: 'hidden',
    marginTop: 2,
  },
  queueFill: { height: '100%', backgroundColor: baseColors.accent },
  queueEmpty: { color: baseColors.textTertiary, fontSize: fontSize.sm, paddingVertical: spacing.sm },
  queueAction: { paddingVertical: spacing.md },
  queueText: { color: baseColors.accent, fontSize: fontSize.md, fontWeight: '600' },
  queueTextMuted: { color: baseColors.textTertiary },
  notice: { color: baseColors.textSecondary, fontSize: fontSize.sm, paddingTop: spacing.md },
  end: { height: spacing.xxl },
});
