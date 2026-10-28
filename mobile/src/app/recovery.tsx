import { Ionicons } from '@expo/vector-icons';
import { back, replace } from '@/services/appNavigation';
import { useState } from 'react';
import {
  ScrollView,
  View,
} from 'react-native';
import { Text } from '@/components/AppText';
import { Press } from '@/components/Press';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { formatDuration } from '@/core/format';
import { useLibrary } from '@/state/LibraryContext';
import { useRecording } from '@/state/RecordingContext';
import { baseColors, fontSize, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

export default function RecoveryScreen() {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  const { recordings, remove } = useLibrary();
  const { resume, finalizeInterrupted } = useRecording();
  const [busyId, setBusyId] = useState<string | null>(null);

  const interrupted = recordings.filter((r) => r.status === 'interrupted');

  const handleContinue = async (id: string) => {
    setBusyId(id);
    await resume(id);
    setBusyId(null);
    replace('/');
  };

  const handleSend = async (id: string) => {
    setBusyId(id);
    await finalizeInterrupted(id);
    setBusyId(null);
    back();
  };

  const handleDiscard = async (id: string) => {
    setBusyId(id);
    await remove(id);
    setBusyId(null);
    if (interrupted.length <= 1) back();
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Press onPress={() => back()} style={styles.back} accessibilityLabel="Voltar">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Press>
        <Text style={styles.title}>Gravação interrompida</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.lead}>
          O app foi encerrado no meio de uma gravação. O áudio já gravado está guardado no aparelho.
        </Text>

        {interrupted.map((recording) => (
          <Card key={recording.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="warning" size={22} color={colors.warning} />
              <View style={styles.cardHeaderText}>
                <Text style={styles.cardTitle}>{recording.title}</Text>
                <Text style={styles.cardMeta}>
                  {recording.segmentCount} segmento(s)
                  {recording.durationMs ? ` - ${formatDuration(recording.durationMs)}` : ''}
                </Text>
              </View>
            </View>
            <View style={styles.actions}>
              <Button
                label="Continuar gravando"
                onPress={() => handleContinue(recording.id)}
                loading={busyId === recording.id}
                style={styles.action}
              />
              <Button
                label="Enviar"
                variant="secondary"
                onPress={() => handleSend(recording.id)}
                disabled={busyId !== null}
                style={styles.action}
              />
              <Button
                label="Descartar"
                variant="danger"
                onPress={() => handleDiscard(recording.id)}
                disabled={busyId !== null}
                style={styles.action}
              />
            </View>
          </Card>
        ))}

        {interrupted.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="checkmark-circle" size={32} color={colors.success} />
            <Text style={styles.emptyText}>Nenhuma gravação pendente.</Text>
          </View>
        ) : null}
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
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: baseColors.text, fontSize: fontSize.lg, fontWeight: '700' },
  content: { padding: spacing.xl, gap: spacing.lg },
  lead: { color: baseColors.textSecondary, fontSize: fontSize.md, lineHeight: 22 },
  card: { gap: spacing.lg },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardHeaderText: { flex: 1, gap: 2 },
  cardTitle: { color: baseColors.text, fontSize: fontSize.md, fontWeight: '600' },
  cardMeta: { color: baseColors.textTertiary, fontSize: fontSize.xs },
  actions: { gap: spacing.sm },
  action: {},
  empty: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xl },
  emptyText: { color: baseColors.textSecondary, fontSize: fontSize.sm },
});
