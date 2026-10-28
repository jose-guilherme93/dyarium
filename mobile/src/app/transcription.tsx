import { Ionicons } from '@expo/vector-icons';
import * as Device from 'expo-device';
import { back } from '@/services/appNavigation';
import { useState } from 'react';
import {
  ScrollView,
  Switch,
  View,
} from 'react-native';
import { Text } from '@/components/AppText';
import { Press } from '@/components/Press';

import { Card } from '@/components/Card';
import { AnalysisModelsSection } from '@/components/AnalysisModelsSection';
import { Screen } from '@/components/Screen';
import { localAnalysisEnabled } from '@/core/features';
import { formatBytes } from '@/core/format';
import {
  TRANSCRIPTION_LANGUAGES,
  TRANSCRIPTION_MODELS,
  recommendModel,
} from '@/core/transcription';
import { localTranscriptionAvailable, releaseTranscriptionContexts } from '@/services/localTranscription';
import {
  deleteModel,
  downloadModel,
  installedModels,
  installedModelsBytes,
} from '@/services/transcriptionModels';
import { useSettings } from '@/state/SettingsContext';
import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

export default function TranscriptionScreen() {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  const {
    transcriptionModel,
    setTranscriptionModel,
    transcriptionLanguage,
    setTranscriptionLanguage,
    reviewTranscript,
    setReviewTranscript,
    literalTranscript,
    setLiteralTranscript,
  } = useSettings();

  const available = localTranscriptionAvailable();
  const recommended = recommendModel(Device.totalMemory);
  const [installed, setInstalled] = useState<string[]>(() =>
    installedModels().map((model) => model.id),
  );
  const [bytes, setBytes] = useState<number>(() => installedModelsBytes());
  const [downloading, setDownloading] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    setInstalled(installedModels().map((model) => model.id));
    setBytes(installedModelsBytes());
  };

  const handleDownload = async (id: string) => {
    setError(null);
    setDownloading(id);
    setProgress(0);
    try {
      await downloadModel(id, { onProgress: setProgress });
      refresh();
      if (!installed.includes(transcriptionModel)) await setTranscriptionModel(id);
    } catch {
      setError('Não foi possível baixar o modelo. Verifique a conexão.');
    } finally {
      setDownloading(null);
    }
  };

  const handleDelete = async (id: string) => {
    await releaseTranscriptionContexts();
    deleteModel(id);
    refresh();
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Press
          onPress={() => back()}
          style={styles.iconButton}
          accessibilityLabel="Voltar"
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Press>
        <Text style={styles.headerTitle}>Modelos no aparelho</Text>
        <View style={styles.iconButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {!available ? (
          <Card style={styles.notice}>
            <Ionicons name="construct-outline" size={18} color={colors.warning} />
            <Text style={styles.noticeText}>
              Este build não tem os módulos nativos. A transcrição só roda no servidor, se houver
              um conectado.
            </Text>
          </Card>
        ) : null}

        <Text style={styles.sectionLabel}>Idioma</Text>
        <Card style={styles.card}>
          <View style={styles.segment}>
            {TRANSCRIPTION_LANGUAGES.map((option) => {
              const active = transcriptionLanguage === option.value;
              return (
                <Press
                  key={option.value}
                  onPress={() => void setTranscriptionLanguage(option.value)}
                  style={[styles.segmentItem, active && styles.segmentActive]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                    {option.label}
                  </Text>
                </Press>
              );
            })}
          </View>
        </Card>

        <Text style={styles.sectionLabel}>Modelos de transcrição</Text>
        <Text style={styles.cardHint}>
          Recomendado para este aparelho: {recommended.label}. Do mais leve ao mais preciso.
        </Text>

        {TRANSCRIPTION_MODELS.map((model) => {
          const isInstalled = installed.includes(model.id);
          const isSelected = transcriptionModel === model.id;
          const isDownloading = downloading === model.id;
          return (
            <Card key={model.id} style={styles.modelCard}>
              <Press
                style={styles.modelMain}
                onPress={() => isInstalled && void setTranscriptionModel(model.id)}
                disabled={!isInstalled}
                accessibilityLabel={model.label}
              >
                <Ionicons
                  name={isSelected && isInstalled ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={isSelected && isInstalled ? colors.accent : colors.textTertiary}
                />
                <View style={styles.rowText}>
                  <View style={styles.modelTitleRow}>
                    <Text style={styles.cardTitle}>{model.label}</Text>
                    {recommended.id === model.id ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>Recomendado</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.cardHint}>
                    {formatBytes(model.sizeBytes)}
                    {isInstalled ? ' · baixado' : ''}
                  </Text>
                </View>
              </Press>

              {isDownloading ? (
                <View style={styles.progressWrap}>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressBar, { width: `${Math.round(progress * 100)}%` }]} />
                  </View>
                  <Text style={styles.cardHint}>{Math.round(progress * 100)}%</Text>
                </View>
              ) : isInstalled ? (
                <Press
                  onPress={() => void handleDelete(model.id)}
                  accessibilityLabel={`Apagar ${model.label}`}
                  hitSlop={8}
                >
                  <Ionicons name="trash-outline" size={20} color={colors.danger} />
                </Press>
              ) : (
                <Press
                  style={styles.downloadButton}
                  onPress={() => void handleDownload(model.id)}
                  accessibilityLabel={`Baixar ${model.label}`}
                >
                  <Ionicons name="download-outline" size={16} color={colors.text} />
                  <Text style={styles.downloadText}>Baixar</Text>
                </Press>
              )}
            </Card>
          );
        })}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.cardHint}>
          {bytes > 0 ? `Usando ${formatBytes(bytes)} no aparelho.` : 'Nenhum modelo baixado.'}
        </Text>

        {localAnalysisEnabled() ? (
          <>
            <Text style={styles.sectionLabel}>Transcrição revisada</Text>
            <Card style={styles.card}>
              <View style={styles.toggleRow}>
                <View style={styles.rowText}>
                  <Text style={styles.cardTitle}>Revisar transcrição com IA</Text>
                  <Text style={styles.cardHint}>
                    Corrige concordância, pontuação e siglas antes de analisar, usando o modelo
                    local. Desligada, a análise continua, mas perde precisão sobre a fala. Vale só
                    neste aparelho: o dashboard tem a própria opção.
                  </Text>
                </View>
                <Switch
                  value={reviewTranscript}
                  onValueChange={(value) => void setReviewTranscript(value)}
                  trackColor={{ true: colors.accent }}
                  accessibilityLabel="Revisar transcrição com IA"
                />
              </View>
              {reviewTranscript ? (
                <View style={styles.toggleRow}>
                  <View style={styles.rowText}>
                    <Text style={styles.cardTitle}>Transcrição literal</Text>
                    <Text style={styles.cardHint}>
                      Mantém hesitações e repetições de gagueira. Desligada, só o que não tem
                      significado sai; marcadores como tipo e né ficam sempre, junto das gírias.
                    </Text>
                  </View>
                  <Switch
                    value={literalTranscript}
                    onValueChange={(value) => void setLiteralTranscript(value)}
                    trackColor={{ true: colors.accent }}
                    accessibilityLabel="Transcrição literal"
                  />
                </View>
              ) : null}
            </Card>
          </>
        ) : null}

        <AnalysisModelsSection />
      </ScrollView>
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
  content: { padding: spacing.xl, gap: spacing.md },
  sectionLabel: {
    color: baseColors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: spacing.sm,
  },
  card: { gap: spacing.sm },
  cardTitle: { color: baseColors.text, fontSize: fontSize.md, fontWeight: '600' },
  cardHint: { color: baseColors.textSecondary, fontSize: fontSize.sm },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  noticeText: { flex: 1, color: baseColors.textSecondary, fontSize: fontSize.sm, lineHeight: 20 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowText: { flex: 1, gap: 2 },
  segment: {
    flexDirection: 'row',
    backgroundColor: baseColors.bgElevated,
    borderRadius: radius.pill,
    padding: 3,
    gap: 3,
  },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.pill },
  segmentActive: { backgroundColor: baseColors.accent },
  segmentText: { color: baseColors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  segmentTextActive: { color: baseColors.onAccent },
  modelCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  modelMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  modelTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  badge: {
    backgroundColor: baseColors.accentSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: { color: baseColors.accent, fontSize: fontSize.xs, fontWeight: '700' },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: baseColors.surfaceElevated,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  downloadText: { color: baseColors.text, fontSize: fontSize.sm, fontWeight: '600' },
  progressWrap: { alignItems: 'flex-end', gap: 4, width: 72 },
  progressTrack: {
    width: 72,
    height: 3,
    borderRadius: 2,
    backgroundColor: baseColors.surfaceElevated,
    overflow: 'hidden',
  },
  progressBar: { height: 3, borderRadius: 2, backgroundColor: baseColors.accent },
  error: { color: baseColors.danger, fontSize: fontSize.sm },
});
