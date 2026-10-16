import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { formatBytes } from '@/core/format';
import { pickBackupFolder, runBackup, runRestore, type BackupSummary } from '@/services/backup';
import { useLibrary } from '@/state/LibraryContext';
import { useSettings } from '@/state/SettingsContext';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

/** Mostra a parte final do caminho (o resto nao informa nada). */
function shortFolder(uri: string): string {
  const clean = decodeURIComponent(uri.replace(/^content:\/\//, '').replace(/^file:\/\//, ''));
  const parts = clean.split('/').filter(Boolean);
  return parts.slice(-2).join('/') || clean;
}

function summaryLine(summary: BackupSummary): string {
  const notes = `${summary.notes} nota${summary.notes === 1 ? '' : 's'}`;
  const files = `${summary.files} arquivo${summary.files === 1 ? '' : 's'}`;
  return `${notes}, ${files} (${formatBytes(summary.bytes)})`;
}

export default function BackupScreen() {
  const { backupFolder, setBackupFolder } = useSettings();
  const { refresh } = useLibrary();
  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePick = async () => {
    setError(null);
    setMessage(null);
    try {
      const uri = await pickBackupFolder(backupFolder);
      if (uri) await setBackupFolder(uri);
    } catch {
      setError('Não foi possível abrir a pasta.');
    }
  };

  const handleBackup = async () => {
    if (!backupFolder || busy) return;
    setBusy('backup');
    setError(null);
    setMessage(null);
    setProgress(null);
    try {
      const summary = await runBackup(backupFolder, (done, total) =>
        setProgress(`${done}/${total}`),
      );
      setMessage(`Backup concluído: ${summaryLine(summary)}.`);
    } catch {
      setError('Não foi possível fazer o backup. Confira se a pasta ainda está acessível.');
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const handleRestore = () => {
    if (!backupFolder || busy) return;
    Alert.alert(
      'Restaurar backup',
      'Traz as notas da pasta escolhida para este aparelho, com áudio, imagens e transcrição. Notas com o mesmo identificador são atualizadas; as demais são mantidas.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Restaurar',
          style: 'destructive',
          onPress: () => {
            setBusy('restore');
            setError(null);
            setMessage(null);
            setProgress(null);
            void runRestore(backupFolder, (done, total) => setProgress(`${done}/${total}`))
              .then(async (summary) => {
                await refresh();
                setMessage(`Restaurado: ${summaryLine(summary)}.`);
              })
              .catch(() => setError('Não foi possível restaurar. Confira se a pasta tem um backup.'))
              .finally(() => {
                setBusy(null);
                setProgress(null);
              });
          },
        },
      ],
    );
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconButton} accessibilityLabel="Voltar">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Backup local</Text>
        <View style={styles.iconButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Pasta do backup</Text>
          <Text style={styles.folder} numberOfLines={2}>
            {backupFolder ? shortFolder(backupFolder) : 'Nenhuma pasta escolhida'}
          </Text>
        </View>

        <Text style={styles.hint}>
          O backup copia tudo o que você tem para uma pasta do aparelho: notas, áudio, imagens e
          links, em ordem. Escolha uma pasta (ex.: Downloads) — o ideal é que ela permaneça acessível
          e, de preferência, seja sincronizada por outro app (Drive, etc.).
        </Text>

        <Button
          label={backupFolder ? 'Trocar pasta' : 'Escolher pasta'}
          variant="secondary"
          onPress={() => void handlePick()}
          disabled={busy !== null}
        />

        <Button
          label={busy === 'backup' ? 'Fazendo backup...' : 'Fazer backup agora'}
          onPress={() => void handleBackup()}
          disabled={!backupFolder || busy !== null}
          loading={busy === 'backup'}
        />

        <Button
          label={busy === 'restore' ? 'Restaurando...' : 'Restaurar backup'}
          variant="secondary"
          onPress={handleRestore}
          disabled={!backupFolder || busy !== null}
          loading={busy === 'restore'}
        />

        {progress ? <Text style={styles.status}>Processando {progress}...</Text> : null}
        {message ? <Text style={styles.success}>{message}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
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
  content: { padding: spacing.xl, gap: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  cardLabel: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  folder: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  hint: { color: colors.textSecondary, fontSize: fontSize.sm, lineHeight: 20 },
  status: { color: colors.textSecondary, fontSize: fontSize.sm },
  success: { color: colors.success, fontSize: fontSize.sm },
  error: { color: colors.danger, fontSize: fontSize.sm },
});
