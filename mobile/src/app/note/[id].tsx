import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { RichEditor, type RichEditorHandle } from '@/components/RichEditor';
import { Screen } from '@/components/Screen';
import { STATUS_META } from '@/components/StatusChip';
import { Waveform } from '@/components/Waveform';
import { formatDuration } from '@/core/format';
import { countWords } from '@/core/richText';
import { useLibrary } from '@/state/LibraryContext';
import { useRecording } from '@/state/RecordingContext';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

/**
 * Tela da nota: sempre editavel (titulo e texto), com gravacao de audio embutida
 * e autosave. O corpo usa um editor rico (negrito/italico/lista renderizados de
 * verdade); se o modulo nativo ainda nao estiver no build, cai para um editor
 * simples. Nao ha botao de salvar; ao sair, a nota e enviada ou sincronizada.
 */

function AudioPlayer({ uri }: { uri: string }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const duration = status.duration || 0;
  const current = status.currentTime || 0;

  const toggle = () => {
    if (status.playing) player.pause();
    else player.play();
  };

  return (
    <View style={styles.player}>
      <Pressable
        style={styles.play}
        onPress={toggle}
        accessibilityLabel={status.playing ? 'Pausar' : 'Tocar'}
      >
        <Ionicons
          name={status.playing ? 'pause' : 'play'}
          size={22}
          color={colors.text}
          style={status.playing ? undefined : { marginLeft: 2 }}
        />
      </Pressable>
      <Text style={styles.playerTime}>
        {formatDuration(current * 1000)} / {formatDuration(duration * 1000)}
      </Text>
    </View>
  );
}

export default function NoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const library = useLibrary();
  const { active, elapsedMs, level, error, busy, start, stop } = useRecording();
  const note = library.recordings.find((r) => r.id === id);
  const noteId = note?.id;

  const [title, setTitle] = useState(() => note?.title ?? '');
  const [body, setBody] = useState(() => note?.text ?? '');
  const initializedRef = useRef(false);
  const dirtyRef = useRef(false);
  const editorRef = useRef<RichEditorHandle>(null);

  const titleRef = useRef(title);
  const bodyRef = useRef(body);
  useEffect(() => {
    titleRef.current = title;
  }, [title]);
  useEffect(() => {
    bodyRef.current = body;
  }, [body]);

  const statusRef = useRef(note?.status);
  useEffect(() => {
    statusRef.current = note?.status;
  }, [note?.status]);

  const submitRef = useRef(library.submitNote);
  const updateRef = useRef(library.updateNote);
  useEffect(() => {
    submitRef.current = library.submitNote;
    updateRef.current = library.updateNote;
  }, [library.submitNote, library.updateNote]);

  // Carrega o conteudo da nota uma vez, quando ela aparece.
  useEffect(() => {
    if (note && !initializedRef.current) {
      initializedRef.current = true;
      setTitle(note.title);
      setBody(note.text ?? '');
    }
  }, [note]);

  // Autosave local (debounced).
  useEffect(() => {
    if (!noteId) return undefined;
    const timer = setTimeout(() => {
      void updateRef.current(noteId, { title: titleRef.current, text: bodyRef.current });
    }, 600);
    return () => clearTimeout(timer);
  }, [title, body, noteId]);

  // Ao sair: grava e envia rascunho (ou sincroniza, se editada).
  useEffect(() => {
    if (!noteId) return undefined;
    return () => {
      void updateRef
        .current(noteId, { title: titleRef.current, text: bodyRef.current })
        .then(() => {
          if (dirtyRef.current || statusRef.current === 'draft') {
            return submitRef.current(noteId);
          }
          return undefined;
        })
        .catch(() => undefined);
    };
  }, [noteId]);

  const recording = Boolean(active);

  const handleRecord = async () => {
    if (!noteId) return;
    if (recording) {
      const finished = await stop({ enqueue: false });
      if (finished) await library.attachAudio(noteId, finished);
    } else {
      await start();
    }
  };

  if (!note) {
    return (
      <Screen>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.replace('/')}
            style={styles.iconButton}
            accessibilityLabel="Voltar"
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Nota</Text>
          <View style={styles.iconButton} />
        </View>
        <View style={styles.center}>
          <Text style={styles.empty}>Nota nao encontrada.</Text>
        </View>
      </Screen>
    );
  }

  const meta = STATUS_META[note.status];
  const hasAudio = Boolean(note.filePath);
  const words = countWords(body);

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.replace('/')}
          style={styles.iconButton}
          accessibilityLabel="Voltar"
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Nota</Text>
        <View style={styles.iconButton} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TextInput
          value={title}
          onChangeText={(value) => {
            dirtyRef.current = true;
            setTitle(value);
          }}
          placeholder="titulo da nota"
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.accent}
          returnKeyType="next"
          blurOnSubmit={false}
          onSubmitEditing={() => editorRef.current?.focus()}
          style={styles.titleInput}
        />

        <View style={styles.toolbar}>
          <Pressable
            style={styles.tool}
            onPress={() => editorRef.current?.format('bold')}
            accessibilityLabel="Negrito"
          >
            <Text style={styles.toolBold}>B</Text>
          </Pressable>
          <Pressable
            style={styles.tool}
            onPress={() => editorRef.current?.format('italic')}
            accessibilityLabel="Italico"
          >
            <Text style={styles.toolItalic}>I</Text>
          </Pressable>
          <Pressable
            style={styles.tool}
            onPress={() => editorRef.current?.format('list')}
            accessibilityLabel="Lista"
          >
            <Ionicons name="list" size={18} color={colors.text} />
          </Pressable>
        </View>

        <View style={styles.metaRow}>
          {note.status === 'completed' ? (
            <>
              <Ionicons name="cloud-done" size={14} color={colors.success} />
              <Text style={styles.meta}>Sincronizada</Text>
            </>
          ) : (
            <>
              <View style={[styles.dot, { backgroundColor: meta.color }]} />
              <Text style={styles.meta}>{meta.label}</Text>
            </>
          )}
          {note.duplicate ? <Text style={styles.meta}>· ja existia</Text> : null}
          {note.status === 'failed' && note.lastError ? (
            <Text style={styles.meta}>· {note.lastError}</Text>
          ) : null}
        </View>

        {hasAudio ? <AudioPlayer uri={note.filePath as string} /> : null}

        {recording ? (
          <View style={styles.recordingView}>
            <Text style={styles.timer}>{formatDuration(elapsedMs)}</Text>
            <Waveform active level={level} height={64} color={colors.textSecondary} />
            <Text style={styles.recHint}>Gravando audio...</Text>
          </View>
        ) : null}

        <RichEditor
          ref={editorRef}
          value={body}
          onChangeMarkdown={(markdown) => {
            dirtyRef.current = true;
            setBody(markdown);
          }}
          placeholder={hasAudio ? 'Escreva sobre este audio...' : 'Comece a escrever...'}
        />

        <Text style={styles.wordCount}>
          {words} {words === 1 ? 'palavra' : 'palavras'}
        </Text>

        {hasAudio && note.transcript && note.transcript !== note.text ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Transcricao</Text>
            <Text style={styles.transcript}>{note.transcript}</Text>
          </View>
        ) : hasAudio && note.transcriptStatus === 'pending' ? (
          <Text style={styles.meta}>Transcrevendo...</Text>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {note.status === 'failed' ? (
          <Pressable
            style={styles.retry}
            onPress={() => void library.retry(note.id)}
            accessibilityLabel="Reenviar"
          >
            <Ionicons name="refresh" size={18} color={colors.warning} />
            <Text style={styles.retryText}>Reenviar</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <View style={styles.bottomBar}>
        {hasAudio ? (
          <Text style={styles.bottomHint}>Audio anexado</Text>
        ) : (
          <Pressable
            style={[styles.recordButton, recording && styles.recordButtonActive]}
            onPress={() => void handleRecord()}
            disabled={busy}
            accessibilityLabel={recording ? 'Parar gravacao' : 'Gravar audio'}
          >
            <Ionicons name={recording ? 'stop' : 'mic'} size={26} color="#FFFFFF" />
          </Pressable>
        )}
      </View>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: colors.textSecondary, fontSize: fontSize.md },
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxxl },
  titleInput: {
    color: colors.text,
    fontSize: fontSize.xxl,
    fontWeight: '700',
    paddingVertical: spacing.sm,
  },
  toolbar: { flexDirection: 'row', gap: spacing.sm },
  tool: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolBold: { color: colors.text, fontSize: fontSize.md, fontWeight: '800' },
  toolItalic: { color: colors.text, fontSize: fontSize.md, fontWeight: '600', fontStyle: 'italic' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  meta: { color: colors.textSecondary, fontSize: fontSize.sm },
  player: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  play: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerTime: { color: colors.text, fontSize: fontSize.md, fontVariant: ['tabular-nums'] },
  recordingView: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg },
  timer: {
    color: colors.text,
    fontSize: fontSize.xxl,
    fontWeight: '300',
    fontVariant: ['tabular-nums'],
  },
  recHint: { color: colors.textSecondary, fontSize: fontSize.sm },
  wordCount: { color: colors.textTertiary, fontSize: fontSize.xs, textAlign: 'right' },
  section: { gap: spacing.sm },
  sectionLabel: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  transcript: { color: colors.textSecondary, fontSize: fontSize.md, lineHeight: 22 },
  error: { color: colors.danger, fontSize: fontSize.sm },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  retryText: { color: colors.warning, fontSize: fontSize.sm, fontWeight: '600' },
  bottomBar: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  bottomHint: { color: colors.textTertiary, fontSize: fontSize.sm },
  recordButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.record,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordButtonActive: { backgroundColor: colors.recordStrong },
});
