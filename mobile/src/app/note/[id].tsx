import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InteractionManager, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { RichEditor, type RichEditorHandle } from '@/components/RichEditor';
import { Screen } from '@/components/Screen';
import { STATUS_META } from '@/components/StatusChip';
import { bytesToBase64 } from '@/core/base64';
import { formatDuration } from '@/core/format';
import { countWords, markdownToPlain } from '@/core/richText';
import { saveLocalImage, resolveImageSources, uploadLocalImage } from '@/services/attachments';
import { pickImage } from '@/services/image';
import { useLibrary } from '@/state/LibraryContext';
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
  const note = useMemo(
    () => library.recordings.find((r) => r.id === id),
    [library.recordings, id],
  );
  const noteId = note?.id;

  const [title, setTitle] = useState(() => note?.title ?? '');
  const [body, setBody] = useState(() => note?.text ?? '');
  const [imageSources, setImageSources] = useState<Record<string, string> | null>(null);
  const initializedRef = useRef(false);
  const dirtyRef = useRef(false);
  const editorRef = useRef<RichEditorHandle>(null);

  // Handlers estaveis: o editor (memoizado) nao pode re-renderizar a cada tecla.
  const handleTitleChange = useCallback((value: string) => {
    dirtyRef.current = true;
    setTitle(value);
  }, []);

  const handleBodyChange = useCallback((markdown: string) => {
    dirtyRef.current = true;
    setBody(markdown);
  }, []);

  // Voltar de verdade (pop): usa a animacao inversa e reaproveita a home, em vez
  // de substituir a tela (que remontava a home e animava errado).
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);

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
  const refreshRef = useRef(library.refresh);
  useEffect(() => {
    submitRef.current = library.submitNote;
    updateRef.current = library.updateNote;
    refreshRef.current = library.refresh;
  }, [library.submitNote, library.updateNote, library.refresh]);

  // Carrega o conteudo da nota uma vez, quando ela aparece, e resolve as fontes
  // das imagens (local ou anexo do servidor) para exibir no editor.
  useEffect(() => {
    if (note && !initializedRef.current) {
      initializedRef.current = true;
      setTitle(note.title);
      setBody(note.text ?? '');
      void resolveImageSources(note.id, note.text ?? '')
        .then(setImageSources)
        .catch(() => setImageSources({}));
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

  // Ao sair: grava e envia. Roda so depois da transicao de volta, para o trabalho
  // (DB, enqueue, rede) nao competir com a animacao.
  useEffect(() => {
    if (!noteId) return undefined;
    const id = noteId;
    return () => {
      const title = titleRef.current;
      const text = bodyRef.current;
      const dirty = dirtyRef.current;
      const status = statusRef.current;
      InteractionManager.runAfterInteractions(() => {
        void updateRef
          .current(id, { title, text })
          .then(() => {
            if (dirty || status === 'draft') return submitRef.current(id);
            return undefined;
          })
          .then(() => refreshRef.current())
          .catch(() => undefined);
      });
    };
  }, [noteId]);

  const handleRecord = () => {
    if (!noteId) return;
    router.push({ pathname: '/record', params: { noteId } });
  };

  const handleAddImage = async () => {
    if (!noteId) return;
    try {
      const picked = await pickImage();
      if (!picked) return;
      // Salva local primeiro: funciona offline.
      const name = await saveLocalImage(noteId, picked.bytes, picked.mimeType);
      let persistSrc = `local:${name}`;
      // Com servidor e entrada, sobe agora e passa a referenciar o anexo.
      if (note?.entryId) {
        try {
          const id = await uploadLocalImage(note.entryId, noteId, name);
          persistSrc = `attachment:${id}`;
        } catch {
          // offline: fica local e sobe no sync
        }
      }
      const dataUri = `data:${picked.mimeType};base64,${bytesToBase64(picked.bytes)}`;
      editorRef.current?.insertImage(dataUri, persistSrc, picked.name);
      dirtyRef.current = true;
    } catch {
      // falha ao anexar imagem: segue sem anexar
    }
  };

  if (!note) {
    return (
      <Screen>
        <View style={styles.header}>
          <Pressable
            onPress={goBack}
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

  const handleShare = async () => {
    const parts: string[] = [title.trim() || note.title];
    const plain = markdownToPlain(body).trim();
    if (plain) parts.push('', plain);
    if (hasAudio && note.transcript && note.transcript.trim() && note.transcript !== body) {
      parts.push('', note.transcript.trim());
    }
    try {
      await Share.share({ message: parts.join('\n') });
    } catch {
      // compartilhamento cancelado ou indisponivel
    }
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable
          onPress={goBack}
          style={styles.iconButton}
          accessibilityLabel="Voltar"
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Nota</Text>
        <Pressable
          onPress={() => void handleShare()}
          style={styles.iconButton}
          accessibilityLabel="Compartilhar"
        >
          <Ionicons name="share-outline" size={22} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TextInput
          value={title}
          onChangeText={handleTitleChange}
          placeholder="titulo da nota"
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.accent}
          returnKeyType="next"
          blurOnSubmit={false}
          onSubmitEditing={() => editorRef.current?.focus()}
          style={styles.titleInput}
        />

        <View style={styles.audioRow}>
          {hasAudio ? null : (
            <Pressable
              style={styles.audioButton}
              onPress={handleRecord}
              accessibilityLabel="Gravar audio"
            >
              <Ionicons name="mic" size={22} color="#FFFFFF" />
            </Pressable>
          )}
        </View>

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
          <Pressable
            style={styles.tool}
            onPress={() => void handleAddImage()}
            accessibilityLabel="Imagem"
          >
            <Ionicons name="image-outline" size={18} color={colors.text} />
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

        {imageSources ? (
          <RichEditor
            ref={editorRef}
            value={body}
            onChangeMarkdown={handleBodyChange}
            placeholder={hasAudio ? 'Escreva sobre este audio...' : 'Comece a escrever...'}
            imageSources={imageSources}
          />
        ) : (
          <View style={styles.editorPlaceholder} />
        )}

        <Text style={styles.wordCount}>
          {words} {words === 1 ? 'palavra' : 'palavras'}
        </Text>

        {hasAudio && note.transcript && note.transcript.trim() ? (
          <Pressable
            style={styles.section}
            onPress={() => router.push({ pathname: '/transcript/[id]', params: { id: note.id } })}
            accessibilityLabel="Abrir transcricao completa"
          >
            <Text style={styles.sectionLabel}>Transcricao</Text>
            <Text style={styles.transcript} numberOfLines={4}>
              {note.transcript}
            </Text>
          </Pressable>
        ) : hasAudio && note.transcriptStatus === 'pending' ? (
          <Text style={styles.meta}>Transcrevendo...</Text>
        ) : null}

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
  editorPlaceholder: { minHeight: 160 },
  titleInput: {
    color: colors.text,
    fontSize: fontSize.xxl,
    fontWeight: '700',
    paddingVertical: spacing.sm,
  },
  audioRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  audioButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.record,
    alignItems: 'center',
    justifyContent: 'center',
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
