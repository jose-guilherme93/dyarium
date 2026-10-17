import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { formatBytes, formatDateTime } from '@/core/format';
import {
  BackupError,
  pickBackupFolder,
  readManifestSummary,
  runBackup,
  runRestore,
  type BackupInfo,
  type BackupSummary,
} from '@/services/backup';
import { listRecordings } from '@/services/db';
import { reassertNotesOnServer, type ReassertResult } from '@/services/reassert';
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

function messageFor(error: unknown): string {
  const code = error instanceof BackupError ? error.code : undefined;
  switch (code) {
    case 'manifest_missing':
      return 'Não encontrei um backup nessa pasta.';
    case 'manifest_invalid':
      return 'O backup nessa pasta é inválido ou de outra versão.';
    case 'corrupt':
      return 'O backup está corrompido ou incompleto; a restauração foi interrompida.';
    case 'hash_failed':
      return 'Não foi possível conferir um arquivo do backup.';
    default:
      return 'Não foi possível concluir. Confira se a pasta ainda está acessível.';
  }
}

/**
 * Frase do que aconteceu no servidor depois da restauração. Uma falha de rede
 * aqui nunca apaga nada: a nota fica no aparelho e volta na próxima sincronização.
 */
function serverLine(result: ReassertResult): string | null {
  const { restored, recreated, failed } = result;
  if (restored === 0 && recreated === 0 && failed === 0) return null;
  const parts: string[] = [];
  if (restored > 0) parts.push(`${restored} de volta no servidor`);
  if (recreated > 0) parts.push(`${recreated} recriada${recreated === 1 ? '' : 's'} no servidor`);
  if (failed > 0) parts.push(`${failed} aguardando conexão`);
  return `Sincronização: ${parts.join(', ')}.`;
}

export default function BackupScreen() {
  const { backupFolder, setBackupFolder } = useSettings();
  const { refresh } = useLibrary();
  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ folder: string; info: BackupInfo | null } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!backupFolder) return undefined;
    let alive = true;
    readManifestSummary(backupFolder)
      .then((value) => {
        if (alive) setLoaded({ folder: backupFolder, info: value });
      })
      .catch(() => {
        if (alive) setLoaded({ folder: backupFolder, info: null });
      });
    return () => {
      alive = false;
    };
  }, [backupFolder, reload]);

  // So vale para a pasta atual (evita mostrar o resumo de uma pasta antiga).
  const info = loaded && loaded.folder === backupFolder ? loaded.info : null;

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
      setReload((n) => n + 1);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const handleRestore = () => {
    if (!backupFolder || busy) return;
    Alert.alert(
      'Restaurar backup',
      'Traz as notas da pasta escolhida para este aparelho, com áudio, imagens e transcrição. Cada arquivo é conferido antes de entrar. Notas com o mesmo identificador são atualizadas; as demais são mantidas. Se uma nota tinha sido apagada, ela volta também no servidor.',
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
                // Reafirma as notas no servidor ANTES de sincronizar: uma nota
                // apagada e trazida de volta pelo backup nao pode ser apagada de
                // novo pelo servidor.
                setProgress(null);
                const restoredNotes = await listRecordings();
                const server = await reassertNotesOnServer(restoredNotes).catch(() => null);
                await refresh();
                const line = server ? serverLine(server) : null;
                setMessage(
                  `Restaurado: ${summaryLine(summary)}.${line ? ` ${line}` : ''}`,
                );
              })
              .catch((err) => setError(messageFor(err)))
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

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Backup nessa pasta</Text>
          {info ? (
            <>
              <Text style={styles.infoStrong}>{summaryLine(info)}</Text>
              <Text style={styles.infoFaint}>
                Criado em {formatDateTime(info.createdAt)}
                {info.appVersion ? ` · app ${info.appVersion}` : ''}
              </Text>
            </>
          ) : (
            <Text style={styles.infoFaint}>Nenhum backup encontrado.</Text>
          )}
        </View>

        <Text style={styles.hint}>
          O backup copia tudo o que você tem para uma pasta do aparelho: notas, áudio, imagens e
          links, em ordem. Cada arquivo leva um código de verificação, conferido ao restaurar. Use
          uma pasta dedicada (de preferência vazia) e que fique acessível.
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
          disabled={!backupFolder || !info || busy !== null}
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
  infoStrong: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  infoFaint: { color: colors.textSecondary, fontSize: fontSize.sm },
  hint: { color: colors.textSecondary, fontSize: fontSize.sm, lineHeight: 20 },
  status: { color: colors.textSecondary, fontSize: fontSize.sm },
  success: { color: colors.success, fontSize: fontSize.sm },
  error: { color: colors.danger, fontSize: fontSize.sm },
});
