import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  InteractionManager,
  Keyboard,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { NoteMenu, type NoteProperty } from '@/components/NoteMenu';
import { RichEditor, type RichEditorHandle } from '@/components/RichEditor';
import { Screen } from '@/components/Screen';
import { STATUS_META } from '@/components/StatusChip';
import {
  formatBytes,
  formatDateTime,
  formatDuration,
  titleFontSize,
  utf8ByteLength,
} from '@/core/format';
import { countChars, countWords, markdownToPlain } from '@/core/richText';
import { needsNoteSync } from '@/core/types';
import {
  localImageUri,
  resolveImageSources,
  saveLocalImage,
  uploadLocalImage,
} from '@/services/attachments';
import { directoryBytes, sessionDirectory, sessionDirUri } from '@/services/files';
import { pickImage } from '@/services/image';
import { useLibrary } from '@/state/LibraryContext';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

/**
 * Tela da nota: sempre editavel (titulo e texto), com gravacao de audio embutida
 * e autosave. A nota nasce limpa: as acoes de formatacao so aparecem quando o
 * teclado esta aberto (editando). O menu da nota (tres pontinhos) reune
 * compartilhar e a ficha de propriedades. Ao sair, a nota e enviada ou entra na
 * fila de sync.
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

function ToolButton({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable style={styles.tool} onPress={onPress} accessibilityLabel={label} hitSlop={6}>
      {children}
    </Pressable>
  );
}

export default function NoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const library = useLibrary();
  const { height: windowHeight } = useWindowDimensions();
  const editorMinHeight = Math.max(240, windowHeight - 360);
  const note = useMemo(
    () => library.recordings.find((r) => r.id === id),
    [library.recordings, id],
  );
  const noteId = note?.id;
  // Base `file://` do WebView: permite carregar as imagens locais da nota.
  const editorBaseUrl = useMemo(() => (noteId ? sessionDirUri(noteId) : undefined), [noteId]);

  const [title, setTitle] = useState(() => note?.title ?? '');
  const [body, setBody] = useState(() => note?.text ?? '');
  const [imageSources, setImageSources] = useState<Record<string, string> | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuBytes, setMenuBytes] = useState(0);
  // Barra de acoes visivel so enquanto o teclado esta aberto (editando).
  const [editing, setEditing] = useState(false);
  const initializedRef = useRef(false);
  const dirtyRef = useRef(false);
  const editorRef = useRef<RichEditorHandle>(null);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setEditing(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setEditing(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Handlers estaveis: o editor (memoizado) nao pode re-renderizar a cada tecla.
  const handleTitleChange = useCallback((value: string) => {
    dirtyRef.current = true;
    setTitle(value);
  }, []);

  const handleBodyChange = useCallback((markdown: string) => {
    dirtyRef.current = true;
    setBody(markdown);
  }, []);

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
  // das imagens (arquivo local ou anexo) para exibir no editor.
  useEffect(() => {
    if (note && !initializedRef.current) {
      initializedRef.current = true;
      setTitle(note.title);
      setBody(note.text ?? '');
      void resolveImageSources(note.id, note.text ?? '', note.attachments ?? {})
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

  // Ficha da nota: soma os arquivos locais (audio/imagens) ao abrir o menu.
  const openMenu = useCallback(() => {
    if (noteId) setMenuBytes(directoryBytes(sessionDirectory(noteId)));
    setMenuOpen(true);
  }, [noteId]);

  const handleRecord = useCallback(() => {
    if (!noteId) return;
    router.push({ pathname: '/record', params: { noteId } });
  }, [noteId]);

  const handleAddImage = useCallback(async () => {
    if (!noteId) return;
    try {
      const picked = await pickImage();
      if (!picked) return;
      // Salva local primeiro: funciona offline e exibe sem recomprimir bytes.
      const name = await saveLocalImage(noteId, picked.bytes, picked.mimeType);
      const displaySrc = localImageUri(noteId, name) ?? `local:${name}`;
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
      editorRef.current?.insertImage(displaySrc, persistSrc, picked.name);
      dirtyRef.current = true;
    } catch {
      // falha ao anexar imagem: segue sem anexar
    }
  }, [noteId, note]);

  if (!note) {
    return (
      <Screen>
        <View style={styles.header}>
          <Pressable onPress={goBack} style={styles.iconButton} accessibilityLabel="Voltar">
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <View style={styles.headerActions} />
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
  const chars = countChars(body);
  const dirty = needsNoteSync(note);
  const statusLabel = dirty ? 'Alteracoes pendentes' : meta.label;
  const totalBytes = menuBytes + utf8ByteLength(markdownToPlain(body));
  const properties: NoteProperty[] = [
    { label: 'Criada', value: formatDateTime(note.recordedAt) },
    { label: 'Origem', value: hasAudio ? 'Audio' : 'Texto' },
    { label: 'Palavras', value: String(words) },
    { label: 'Caracteres', value: String(chars) },
    { label: 'Tamanho', value: formatBytes(totalBytes) },
    { label: 'Status', value: statusLabel },
  ];

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
        <Pressable onPress={goBack} style={styles.iconButton} accessibilityLabel="Voltar">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={styles.headerActions}>
          <Pressable
            style={styles.iconButton}
            onPress={handleRecord}
            accessibilityLabel="Gravar audio"
          >
            <Ionicons name="mic-outline" size={22} color={colors.text} />
          </Pressable>
          <Pressable
            style={styles.circleButton}
            onPress={openMenu}
            accessibilityLabel="Configuracoes da nota"
          >
            <Ionicons name="ellipsis-horizontal" size={18} color={colors.text} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
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
          style={[styles.titleInput, { fontSize: titleFontSize(title) }]}
        />

        {dirty || note.status !== 'completed' ? (
          <View style={styles.metaRow}>
            <View style={[styles.dot, { backgroundColor: dirty ? colors.accent : meta.color }]} />
            <Text style={styles.meta}>{statusLabel}</Text>
            {note.duplicate ? <Text style={styles.meta}>· ja existia</Text> : null}
            {note.status === 'failed' && note.lastError ? (
              <Text style={styles.meta}>· {note.lastError}</Text>
            ) : null}
            {note.terminal ? (
              <Text style={styles.meta}>· nao sera reenviado automaticamente</Text>
            ) : null}
          </View>
        ) : null}

        {hasAudio ? <AudioPlayer uri={note.filePath as string} /> : null}

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

        {imageSources ? (
          <RichEditor
            ref={editorRef}
            value={body}
            onChangeMarkdown={handleBodyChange}
            placeholder={hasAudio ? 'Escreva sobre este audio...' : 'Comece a escrever...'}
            imageSources={imageSources}
            baseUrl={editorBaseUrl}
            minHeight={editorMinHeight}
          />
        ) : (
          <View style={styles.editorPlaceholder} />
        )}

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

      {editing ? (
        <View style={styles.toolbar}>
          <ToolButton label="Negrito" onPress={() => editorRef.current?.format('bold')}>
            <Text style={styles.toolBold}>B</Text>
          </ToolButton>
          <ToolButton label="Italico" onPress={() => editorRef.current?.format('italic')}>
            <Text style={styles.toolItalic}>I</Text>
          </ToolButton>
          <ToolButton label="Lista" onPress={() => editorRef.current?.format('list')}>
            <Ionicons name="list-outline" size={20} color={colors.text} />
          </ToolButton>
          <View style={styles.toolDivider} />
          <ToolButton label="Adicionar foto" onPress={() => void handleAddImage()}>
            <Ionicons name="image-outline" size={20} color={colors.text} />
          </ToolButton>
          <ToolButton label="Gravar audio" onPress={handleRecord}>
            <Ionicons name="mic-outline" size={20} color={colors.text} />
          </ToolButton>
        </View>
      ) : null}

      <NoteMenu
        visible={menuOpen}
        title={title}
        properties={properties}
        onClose={() => setMenuOpen(false)}
        onShare={() => {
          setMenuOpen(false);
          void handleShare();
        }}
      />
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  circleButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: colors.textSecondary, fontSize: fontSize.md },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxxl },
  editorPlaceholder: { minHeight: 160 },
  titleInput: {
    color: colors.text,
    fontWeight: '700',
    paddingVertical: spacing.sm,
  },
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
  section: { gap: spacing.sm },
  sectionLabel: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  transcript: { color: colors.textSecondary, fontSize: fontSize.md, lineHeight: 22 },
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
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  tool: { width: 44, height: 40, alignItems: 'center', justifyContent: 'center' },
  toolDivider: { width: StyleSheet.hairlineWidth, height: 22, backgroundColor: colors.border },
  toolBold: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800' },
  toolItalic: { color: colors.text, fontSize: fontSize.lg, fontWeight: '600', fontStyle: 'italic' },
});
