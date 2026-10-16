import { Ionicons } from '@expo/vector-icons';
import * as Device from 'expo-device';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
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
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

export default function TranscriptionScreen() {
  const {
    localTranscription,
    setLocalTranscription,
    transcriptionModel,
    setTranscriptionModel,
    transcriptionLanguage,
    setTranscriptionLanguage,
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
        <Pressable
          onPress={() => router.back()}
          style={styles.iconButton}
          accessibilityLabel="Voltar"
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Transcrição</Text>
        <View style={styles.iconButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {!available ? (
          <Card style={styles.notice}>
            <Ionicons name="construct-outline" size={18} color={colors.warning} />
            <Text style={styles.noticeText}>
              Disponível depois do próximo build: este APK ainda não tem os módulos nativos. Até
              lá, a transcrição continua pelo servidor.
            </Text>
          </Card>
        ) : null}

        <Card style={styles.card}>
          <View style={styles.toggleRow}>
            <View style={styles.rowText}>
              <Text style={styles.cardTitle}>Transcrever no aparelho</Text>
              <Text style={styles.cardHint}>
                Usa o modelo baixado, offline e sem enviar o áudio. Desligado, usa o servidor.
              </Text>
            </View>
            <Switch
              value={localTranscription}
              onValueChange={(value) => void setLocalTranscription(value)}
              trackColor={{ true: colors.accent }}
            />
          </View>
        </Card>

        <Text style={styles.sectionLabel}>Idioma</Text>
        <Card style={styles.card}>
          <View style={styles.segment}>
            {TRANSCRIPTION_LANGUAGES.map((option) => {
              const active = transcriptionLanguage === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => void setTranscriptionLanguage(option.value)}
                  style={[styles.segmentItem, active && styles.segmentActive]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        <Text style={styles.sectionLabel}>Modelos</Text>
        <Text style={styles.cardHint}>
          Recomendado para este aparelho: {recommended.label}. Do mais leve ao mais preciso.
        </Text>

        {TRANSCRIPTION_MODELS.map((model) => {
          const isInstalled = installed.includes(model.id);
          const isSelected = transcriptionModel === model.id;
          const isDownloading = downloading === model.id;
          return (
            <Card key={model.id} style={styles.modelCard}>
              <Pressable
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
              </Pressable>

              {isDownloading ? (
                <View style={styles.progressWrap}>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressBar, { width: `${Math.round(progress * 100)}%` }]} />
                  </View>
                  <Text style={styles.cardHint}>{Math.round(progress * 100)}%</Text>
                </View>
              ) : isInstalled ? (
                <Pressable
                  onPress={() => void handleDelete(model.id)}
                  accessibilityLabel={`Apagar ${model.label}`}
                  hitSlop={8}
                >
                  <Ionicons name="trash-outline" size={20} color={colors.danger} />
                </Pressable>
              ) : (
                <Pressable
                  style={styles.downloadButton}
                  onPress={() => void handleDownload(model.id)}
                  accessibilityLabel={`Baixar ${model.label}`}
                >
                  <Ionicons name="download-outline" size={16} color={colors.text} />
                  <Text style={styles.downloadText}>Baixar</Text>
                </Pressable>
              )}
            </Card>
          );
        })}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.cardHint}>
          {bytes > 0 ? `Usando ${formatBytes(bytes)} no aparelho.` : 'Nenhum modelo baixado.'}
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  content: { padding: spacing.xl, gap: spacing.md },
  sectionLabel: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: spacing.sm,
  },
  card: { gap: spacing.sm },
  cardTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  cardHint: { color: colors.textSecondary, fontSize: fontSize.sm },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  noticeText: { flex: 1, color: colors.textSecondary, fontSize: fontSize.sm, lineHeight: 20 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowText: { flex: 1, gap: 2 },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.bgElevated,
    borderRadius: radius.pill,
    padding: 3,
    gap: 3,
  },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.pill },
  segmentActive: { backgroundColor: colors.accent },
  segmentText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  segmentTextActive: { color: '#FFFFFF' },
  modelCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  modelMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  modelTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  badge: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: { color: colors.accent, fontSize: fontSize.xs, fontWeight: '700' },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  downloadText: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  progressWrap: { alignItems: 'flex-end', gap: 4, width: 72 },
  progressTrack: {
    width: 72,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.surfaceElevated,
    overflow: 'hidden',
  },
  progressBar: { height: 3, borderRadius: 2, backgroundColor: colors.accent },
  error: { color: colors.danger, fontSize: fontSize.sm },
});
