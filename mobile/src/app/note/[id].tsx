import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useAudioPlayerStatus, type AudioPlayer as AudioPlayerHandle } from 'expo-audio';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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

import { ConflictDialog } from '@/components/ConflictDialog';
import { AudioSeekBar } from '@/components/AudioSeekBar';
import { FastModal } from '@/components/FastModal';
import { NoteMenu, type NoteMenuAnchor, type NoteProperty } from '@/components/NoteMenu';
import { NoteReader } from '@/components/NoteReader';
import { DEFAULT_MEASURE, RichEditor, type RichEditorHandle } from '@/components/RichEditor';
import { caretScrollTarget, keyboardOverlap } from '@/core/keyboard';
import { Screen } from '@/components/Screen';
import { STATUS_META } from '@/components/StatusChip';
import { SyncedTranscript } from '@/components/SyncedTranscript';
import { toNoteAnalysis } from '@/core/analysis';
import { checkpointPercent } from '@/core/transcription';
import {
  formatBytes,
  formatDateTime,
  formatDuration,
  titleFontSize,
  utf8ByteLength,
} from '@/core/format';
import { DEFAULT_IMAGE_WIDTH, IMAGE_WIDTH_OPTIONS } from '@/core/image';
import { breakSentences, countChars, countWords, markdownToPlain, removeImageFromMarkdown, setImageWidthInMarkdown } from '@/core/richText';
import { clearNoteConflict, keepMine } from '@/core/noteSync';
import { mark, useRenderCount } from '@/dev/perf';

import {
  attachmentUri,
  downloadMissingImageSources,
  localImageUri,
  resolveImageSourcesLocal,
  saveLocalImage,
  uploadLocalImage,
} from '@/services/attachments';
import { fetchNoteAnalysis } from '@/services/analysis';
import { releaseAudioFocus } from '@/services/audioFocus';
import { getCachedAnalysis, getRecording, upsertRecording, type CachedAnalysis } from '@/services/db';
import { directoryBytes, sessionDirectory, sessionDirUri } from '@/services/files';
import { pickImage } from '@/services/image';
import { maybeTranscribeLocally } from '@/services/localTranscription';
import { enterNote, leaveNote } from '@/services/noteVisibility';
import { fetchTheirs, syncNoteForcing } from '@/services/noteSync';
import { pushTranscript } from '@/services/transcriptSync';
import { playPlayer } from '@/services/playback';
import { useLibrary } from '@/state/LibraryContext';
import { useAudioStack } from '@/state/useAudioStack';
import { useLoadPlayback, usePauseOnUnmount, usePlaybackSource } from '@/state/PlaybackContext';
import { useSettings } from '@/state/SettingsContext';
import { useTranscriptionProgress } from '@/state/useTranscriptionProgress';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

/**
 * Tela da nota: sempre editavel (titulo e texto), com gravacao de audio embutida
 * e autosave. A nota nasce limpa: as acoes de formatacao so aparecem quando o
 * teclado esta aberto (editando). O menu da nota (tres pontinhos) reune
 * compartilhar e a ficha de propriedades. Ao sair, a nota e enviada ou entra na
 * fila de sync.
 */

type PlayerHandle = AudioPlayerHandle;

function NoteAudioPlayer({ player, durationMs }: { player: PlayerHandle; durationMs?: number }) {
  const status = useAudioPlayerStatus(player);
  const load = useLoadPlayback();
  // Antes de carregar, `duration` e 0: usa a duracao conhecida da nota.
  const duration = status.duration > 0 ? status.duration : (durationMs ?? 0) / 1000;
  const current = status.currentTime || 0;
  // Seek pedido antes de a fonte terminar de carregar: aplica quando o player
  // informa a duracao real (antes disso o seek seria ignorado).
  const [pendingSeek, setPendingSeek] = useState<number | null>(null);

  const appliedSeekRef = useRef<number | null>(null);
  useEffect(() => {
    if (pendingSeek === null || status.duration <= 0) return;
    if (appliedSeekRef.current === pendingSeek) return;
    appliedSeekRef.current = pendingSeek;
    void player.seekTo(pendingSeek).catch(() => undefined);
  }, [pendingSeek, player, status.duration]);

  const toggle = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    load();
    playPlayer(player);
  };

  const seek = (seconds: number) => {
    load();
    if (status.duration > 0) {
      void player.seekTo(seconds).catch(() => undefined);
    } else {
      setPendingSeek(seconds);
    }
  };

  useEffect(() => () => releaseAudioFocus(player), [player]);

  return (
    <View style={styles.player}>
      <View style={styles.playerRow}>
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
      <AudioSeekBar current={current} duration={duration} onSeek={seek} />
    </View>
  );
}

/**
 * Previa do texto enquanto o editor (WebView) carrega. O corpo da nota aparece
 * junto com a tela, no mesmo lugar e com a mesma tipografia; quando o editor
 * fica pronto ele toma o lugar, sem a nota abrir "vazia" por um instante.
 */
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
  const { id, action } = useLocalSearchParams<{ id: string; action?: string }>();
  const library = useLibrary();
  const { typography, setTypography, ready: settingsReady } = useSettings();
  // Enquanto esta tela esta viva, a sincronizacao de fundo espera: a nota e
  // local e nao pode disputar SQLite/rede com o que o usuario esta fazendo.
  useEffect(() => {
    enterNote();
    return () => leaveNote();
  }, []);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const editorMinHeight = Math.max(240, windowHeight - 360);
  const note = useMemo(
    () => library.recordings.find((r) => r.id === id),
    [library.recordings, id],
  );
  const noteId = note?.id;
  const liveTranscriptionPercent = useTranscriptionProgress(noteId);
  const transcriptionPercent =
    liveTranscriptionPercent > 0
      ? liveTranscriptionPercent
      : checkpointPercent(note ?? {});
  // Base `file://` do WebView: permite carregar as imagens locais da nota.
  const editorBaseUrl = useMemo(() => (noteId ? sessionDirUri(noteId) : undefined), [noteId]);
  // Player unico do app: o controle de play e a previa de transcricao usam o
  // mesmo audio da nota (sem dois players em conflito).
  const filePath = note?.filePath;
  // Pilha de audios do servidor. O app nao grava varios audios numa nota, mas
  // le a pilha: os audios do dashboard aparecem aqui, cada um com a sua
  // transcricao. Tocar em um deles troca a fonte do mesmo player.
  const stack = useAudioStack(note?.entryId, note?.serverAudios);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [downloadedUri, setDownloadedUri] = useState<string | null>(null);
  const playerUri = playingAudioId ? (downloadedUri ?? undefined) : filePath;
  const player = usePlaybackSource(playerUri);
  const loadPlayback = useLoadPlayback();

  const playStackAudio = useCallback(
    async (audioId: string) => {
      if (playingAudioId === audioId) {
        player.pause();
        setPlayingAudioId(null);
        setDownloadedUri(null);
        return;
      }
      setPlayingAudioId(audioId);
      const uri = await attachmentUri(audioId);
      setDownloadedUri(uri);
    },
    [playingAudioId, player],
  );

  // A pilha troca a fonte do player unico: carrega a fonte apontada e toca.
  useEffect(() => {
    if (!playingAudioId || !downloadedUri) return;
    loadPlayback();
    playPlayer(player);
  }, [playingAudioId, downloadedUri, loadPlayback, player]);
  usePauseOnUnmount();
  const segments = note?.transcriptSegments;
  useRenderCount('NoteScreen');
  // Marco de tempo: da abertura da nota ate o conteudo nativo aparecer.
  const [openedAt] = useState(() => Date.now());
  const [title, setTitle] = useState(() => note?.title ?? '');
  const [body, setBody] = useState(() => note?.text ?? '');
  // Corpo trocado por fora ("ficar com o de la"): o editor monta uma vez com o
  // markdown que recebe, entao remontar e o que aplica o texto novo.
  const [editorKey, setEditorKey] = useState(0);
  const [imageSources, setImageSources] = useState<Record<string, string>>(() =>
    note ? resolveImageSourcesLocal(note.id, note.text ?? '', note.attachments ?? {}) : {},
  );
  const [noteReady, setNoteReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<NoteMenuAnchor | null>(null);
  const [menuBytes, setMenuBytes] = useState(0);
  // Analise ja feita no servidor: o cache aparece na hora e a rede so atualiza.
  const [cachedAnalysis, setCachedAnalysis] = useState<CachedAnalysis | null>(null);
  // Diferencia "ainda nao verifiquei" de "verifiquei e nao ha analise": a
  // secao nao pisca "sem analise" enquanto o refresh silencioso acontece.
  const [analysisChecked, setAnalysisChecked] = useState(false);
  const analysisView = useMemo(
    () =>
      cachedAnalysis && cachedAnalysis.entryId === note?.entryId
        ? toNoteAnalysis(cachedAnalysis.analysis)
        : null,
    [cachedAnalysis, note?.entryId],
  );
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [viewerSrc, setViewerSrc] = useState<string | null>(null);
  const [imageMenu, setImageMenu] = useState<{ src: string; width: number } | null>(null);
  const configButtonRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  // Rolagem atual da nota e posicao do editor: usados para revelar o cursor
  // (o teclado nao deve cobrir a linha que esta sendo escrita).
  const scrollYRef = useRef(0);
  const editorTopRef = useRef(0);
  const caretRef = useRef<number | null>(null);
  const caretScrollAtRef = useRef(0);
  // Barra de acoes visivel so enquanto o teclado esta aberto (editando).
  // Abrir uma nota para leitura NAO monta o editor: ele so aparece no toque.
  const [editing, setEditing] = useState(
    () => action === 'text' || action === 'image' || action === 'link',
  );
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const initializedRef = useRef(false);
  const actionDoneRef = useRef(false);
  const localTranscribeRef = useRef(false);
  const dirtyRef = useRef(false);
  const editorRef = useRef<RichEditorHandle>(null);
  const focusOnEditRef = useRef(false);
  // Enquanto o seletor de imagem/modal esta aberto, o teclado fecha; nao pode
  // desmontar o editor no meio da insercao (senao a foto nao entra).
  const suspendEditingRef = useRef(false);
  // Quando o editor (WebView) comeca a montar.
  const editorMountRef = useRef(0);

  const startEditing = useCallback(() => {
    focusOnEditRef.current = true;
    editorMountRef.current = Date.now();
    setEditing(true);
  }, []);

  useEffect(() => {
    if (editing && !editorMountRef.current) {
      editorMountRef.current = Date.now();
    }
  }, [editing]);

  // Altura da janela sem teclado (capturada no mount). Serve para saber se o
  // Android redimensionou a janela com o teclado (adjustResize) ou nao (edge-to-edge).
  const [baseHeight] = useState(windowHeight);

  // Area visivel da nota (descontando o teclado) e a margem inferior reservada
  // (barra de acoes, quando editando). Fica em ref para o callback do editor
  // ler o valor atual sem recriar o handler do WebView.
  const metricsRef = useRef({ viewport: baseHeight, bottomInset: 96 });
  useEffect(() => {
    metricsRef.current = {
      viewport: Math.min(windowHeight, baseHeight - keyboardHeight),
      bottomInset: editing ? 96 : 24,
    };
  }, [windowHeight, baseHeight, keyboardHeight, editing]);

  // Rola a nota para o cursor ficar acima do teclado. `force` fura o intervalo
  // minimo (usado quando o teclado termina de abrir).
  const scrollCaretIntoView = useCallback((force: boolean) => {
    const caret = caretRef.current;
    if (caret == null) return;
    const now = Date.now();
    // Curto o bastante para acompanhar a digitacao; o `force` fura o intervalo
    // quando o teclado termina de abrir.
    if (!force && now - caretScrollAtRef.current < 120) return;
    const { viewport, bottomInset } = metricsRef.current;
    const target = caretScrollTarget({
      caret,
      editorTop: editorTopRef.current,
      scrollY: scrollYRef.current,
      viewport,
      bottomInset,
      lineHeight: Math.round(typography.size * 1.5),
      topInset: 24,
    });
    if (target === null) return;
    caretScrollAtRef.current = now;
    scrollRef.current?.scrollTo({ y: target, animated: true });
  }, [typography.size]);

  const handleCaret = useCallback(
    (y: number) => {
      caretRef.current = y;
      scrollCaretIntoView(false);
    },
    [scrollCaretIntoView],
  );

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardHeight(event.endCoordinates?.height ?? 0);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
      // Sem teclado, volta para a leitura nativa (desmonta o WebView). Exceto
      // quando o teclado sumiu porque o seletor de imagem/modal abriu.
      if (!suspendEditingRef.current) {
        setEditing(false);
      }
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Parte da altura do teclado que a janela nao absorveu (edge-to-edge). A barra
  // de acoes e o fim da nota precisam reservar esse espaco; sem isso o cursor
  // fica embaixo do teclado e nao da para ver o que se escreve.
  const keyboardLift = keyboardOverlap(keyboardHeight, baseHeight, windowHeight);
  const toolbarLift = keyboardLift;

  // Depois que o teclado abre e o padding da nota e aplicado, revela o cursor.
  useEffect(() => {
    if (!editing) return undefined;
    const timer = setTimeout(() => scrollCaretIntoView(true), 120);
    return () => clearTimeout(timer);
  }, [editing, keyboardHeight, scrollCaretIntoView]);

  // Handlers estaveis: o editor (memoizado) nao pode re-renderizar a cada tecla.
  const handleTitleChange = useCallback((value: string) => {
    dirtyRef.current = true;
    // O titulo quebra linha visualmente, mas continua sendo uma linha logica.
    setTitle(value.replace(/\n/g, ' '));
  }, []);

  const handleBodyChange = useCallback((markdown: string) => {
    // O WebView reemite o conteudo ao montar, normalizado (sem espacos no fim).
    // Isso nao e edicao: sem o guarda, abrir a nota a marcava como suja e o sync
    // reenviava o texto local por cima do que foi editado no dashboard.
    if (markdown.trimEnd() === body.trimEnd()) {
      return;
    }
    dirtyRef.current = true;
    setBody(markdown);
  }, [body]);

  // Tocou na nota (o editor avisa pelo WebView): mostra o menu de acoes.
  const handleEditingChange = useCallback(() => setEditing(true), []);

  // Bloco que o app nao edita (tabela, divisoria): aparece sempre, e so sai com
  // confirmacao — perder a tabela de uma nota sem querer seria pior.
  const handleOpaqueMenu = useCallback((opaque: { label: string; markdown: string }) => {
    Alert.alert(
      `Apagar ${opaque.label}?`,
      'O bloco não é editável aqui e será removido da nota também no dashboard.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Apagar',
          style: 'destructive',
          onPress: () => {
            dirtyRef.current = true;
            editorRef.current?.deleteOpaque(opaque.markdown);
          },
        },
      ],
    );
  }, []);

  // Conflito: o servidor recusou a gravacao porque o campo ja mudou no
  // dashboard. Nada foi sobrescrito; aqui o usuario decide.
  // O dialogo aparece enquanto houver conflito; "decidir depois" esconde sem
  // resolver, e volta a aparecer se o conflito continuar la.
  const conflictFields = note?.syncConflict ?? [];
  const [conflictSnoozed, setConflictSnoozed] = useState<string | null>(null);
  const conflictKey = `${note?.id ?? ''}:${conflictFields.join(',')}`;
  const conflictOpen = conflictFields.length > 0 && conflictSnoozed !== conflictKey;

  const handleKeepMine = useCallback(async () => {
    if (!noteId || !note) return;
    // O nucleo guarda as versoes que o servidor devolveu: com as antigas o
    // proximo sync tomaria 409 de novo e o dialogo voltaria.
    const saved = await keepMine(note, () => getRecording(noteId), syncNoteForcing).catch(() => undefined);
    if (!saved) return;
    await upsertRecording(saved);
    await library.refresh();
  }, [library, note, noteId]);

  const handleTakeTheirs = useCallback(async () => {
    if (!noteId || !note) return;
    const theirs = await fetchTheirs(note).catch(() => undefined);
    if (!theirs) return;
    const fresh = (await getRecording(noteId)) ?? note;
    await upsertRecording(
      clearNoteConflict({
        ...fresh,
        title: theirs.title ?? fresh.title,
        recordedAt: theirs.recordedAt ?? fresh.recordedAt,
        text: theirs.markdown,
        titleVersion: theirs.titleVersion,
        recordedAtVersion: theirs.recordedAtVersion,
        bodyVersion: theirs.bodyVersion,
        // O que veio de la ja esta no servidor: nada a reenviar.
        noteDirty: undefined,
      }),
    );
    setTitle(theirs.title ?? fresh.title);
    setBody(theirs.markdown);
    setEditorKey((value) => value + 1);
    await library.refresh();
  }, [library, note, noteId]);

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

  // Edicao vinda do servidor (dashboard) com a nota aberta: o pull atualiza o
  // banco e aqui o editor e reidratado. Nao toca em quem esta editando
  // (`noteDirty`) nem em conflito em aberto, e ignora quando o texto e o mesmo
  // (o sync do proprio app tambem muda a versao).
  const shownBodyVersion = useRef<string | undefined>(note?.bodyVersion);
  useEffect(() => {
    if (!note || note.noteDirty || (note.syncConflict?.length ?? 0) > 0) return;
    if (note.bodyVersion === shownBodyVersion.current) return;
    shownBodyVersion.current = note.bodyVersion;
    if ((note.text ?? '') === bodyRef.current) return;
    setBody(note.text ?? '');
    setEditorKey((value) => value + 1);
  }, [note]);

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

  // Resolve as imagens que ja estao no aparelho de forma sincrona e monta o
  // editor na hora. As que faltam baixam em segundo plano e sao trocadas no
  // WebView quando chegam: a nota nunca fica presa no preview por causa de uma
  // foto.
  useEffect(() => {
    if (note && !initializedRef.current) {
      initializedRef.current = true;
      setTitle(note.title);
      setBody(note.text ?? '');
      const attachments = note.attachments ?? {};
      const local = resolveImageSourcesLocal(note.id, note.text ?? '', attachments);
      setImageSources(local);
      setNoteReady(true);
      mark('note.ready_ms', Date.now() - openedAt);
      mark('note.images_ms', Date.now() - openedAt);
      void downloadMissingImageSources(note.id, note.text ?? '', attachments, (ref, uri) => {
        setImageSources((current) => ({ ...current, [ref]: uri }));
      }).catch(() => undefined);
    }
  }, [note, openedAt]);

  // Transcricao local: so depois da nota estar na tela e das interacoes
  // assentarem (nunca atrasa a abertura nem compete com a transicao). Se ligada
  // nas configuracoes e com modelo baixado, transcreve.
  useEffect(() => {
    if (localTranscribeRef.current || !note) return undefined;
    if (!note.filePath || note.hasTranscript) return undefined;
    let task: { cancel: () => void } | null = null;
    const timer = setTimeout(() => {
      if (localTranscribeRef.current) return;
      task = InteractionManager.runAfterInteractions(() => {
        if (localTranscribeRef.current) return;
        localTranscribeRef.current = true;
        void maybeTranscribeLocally(note.id).catch(() => undefined);
      });
    }, 1500);
    return () => {
      clearTimeout(timer);
      task?.cancel();
    };
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

  // Analise do servidor: le o cache assim que a nota abre (funciona offline) e
  // busca a versao atual no servidor quando o menu abre, sem gerar analise.
  const analysisEntryId = note?.entryId;
  useEffect(() => {
    if (!analysisEntryId) return;
    let alive = true;
    void getCachedAnalysis(analysisEntryId)
      .then((item) => {
        if (alive) setCachedAnalysis(item);
      })
      .catch(() => {
        // Cache local e best-effort: sem ele a ficha fica sem analise.
      })
      .finally(() => {
        if (alive) setAnalysisChecked(true);
      });
    return () => {
      alive = false;
    };
  }, [analysisEntryId]);

  // Transcricao feita no aparelho antes do audio subir (ou antes desta versao
  // existir): garante que o servidor receba o texto ligado ao audio certo.
  // `pushTranscript` compara o texto e nao reenvia quando ja esta igual.
  useEffect(() => {
    if (!noteId || !note?.entryId || !note.hasTranscript || note.transcriptOrigin !== 'local') {
      return;
    }
    void pushTranscript(noteId);
  }, [noteId, note?.entryId, note?.hasTranscript, note?.transcriptOrigin]);

  const refreshAnalysis = useCallback(async () => {
    const target = note;
    if (!target?.entryId) return;
    const entryTitle = title.trim() || target.title;
    try {
      const analysis = await fetchNoteAnalysis({
        entryId: target.entryId,
        title: entryTitle,
        recordedAt: target.recordedAt,
      });
      if (analysis) {
        setCachedAnalysis({
          entryId: target.entryId,
          title: entryTitle,
          recordedAt: target.recordedAt,
          analysis,
        });
      }
    } catch {
      // Sem rede o cache que ja estiver carregado continua valendo.
    } finally {
      setAnalysisChecked(true);
    }
  }, [note, title]);

  // Ficha da nota: soma os arquivos locais ao abrir o menu e mede o botao para
  // ancorar o popover logo abaixo dele.
  const openMenu = useCallback(() => {
    if (noteId) setMenuBytes(directoryBytes(sessionDirectory(noteId)));
    // Sem cache, esconde a secao durante o refresh silencioso: nada de
    // "sem analise" piscando antes da resposta.
    if (!cachedAnalysis) setAnalysisChecked(false);
    void refreshAnalysis();
    const button = configButtonRef.current;
    if (!button) {
      setMenuOpen(true);
      return;
    }
    button.measureInWindow((x, y, width, height) => {
      setMenuAnchor({ top: y + height + 6, right: Math.max(spacing.lg, windowWidth - (x + width)) });
      setMenuOpen(true);
    });
  }, [cachedAnalysis, noteId, refreshAnalysis, windowWidth]);

  const handleRecord = useCallback(() => {
    if (!noteId) return;
    router.push({ pathname: '/record', params: { noteId } });
  }, [noteId]);

  // Abre a transcricao completa. O player e o mesmo, entao o audio continua
  // exatamente do ponto em que esta (sem parar nem recomecar).
  const openTranscript = useCallback(() => {
    if (!noteId) return;
    router.push({ pathname: '/transcript/[id]', params: { id: noteId } });
  }, [noteId]);

  // Tocar num trecho da previa leva o audio para aquele instante. Espera o
  // `replace` terminar quando a fonte ainda nao estava carregada.
  const seekTranscript = useCallback(
    (startMs: number) => {
      loadPlayback();
      setTimeout(() => {
        void player
          .seekTo(Math.max(0, startMs) / 1000)
          .then(() => player.play())
          .catch(() => undefined);
      }, 80);
    },
    [loadPlayback, player],
  );

  const handleAddImage = useCallback(async () => {
    if (!noteId) return;
    suspendEditingRef.current = true;
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
      // A previa nativa precisa saber que esta referencia aponta para o arquivo
      // local; o markdown em si carrega so `local:`/`attachment:`.
      setImageSources((current) => ({ ...current, [persistSrc]: displaySrc }));
      editorRef.current?.insertImage(displaySrc, persistSrc, picked.name, DEFAULT_IMAGE_WIDTH);
      dirtyRef.current = true;
      // O seletor fecha o teclado; devolve o foco para o paragrafo criado
      // abaixo da foto.
      requestAnimationFrame(() => editorRef.current?.focus());
    } catch {
      // falha ao anexar imagem: segue sem anexar
    } finally {
      suspendEditingRef.current = false;
    }
  }, [noteId, note]);

  // Toque na imagem: abre maior, para conferir. Fecha ao tocar em qualquer lugar.
  const handleImageOpen = useCallback((src: string) => {
    if (src) setViewerSrc(src);
  }, []);
  const closeViewer = useCallback(() => setViewerSrc(null), []);

  // Toque longo: menu da imagem (largura e apagar).
  const handleImageMenu = useCallback((src: string, width: number) => {
    if (src) setImageMenu({ src, width });
  }, []);
  const closeImageMenu = useCallback(() => setImageMenu(null), []);

  const applyImageWidth = useCallback(
    (percent: number) => {
      const target = imageMenu;
      setImageMenu(null);
      if (!target) return;
      if (editorRef.current) {
        editorRef.current.setImageWidth(target.src, percent);
      } else {
        setBody((current) => setImageWidthInMarkdown(current, target.src, percent));
      }
      dirtyRef.current = true;
    },
    [imageMenu],
  );

  const deleteImage = useCallback(() => {
    const target = imageMenu;
    setImageMenu(null);
    if (!target) return;
    if (editorRef.current) {
      editorRef.current.deleteImage(target.src);
    } else {
      setBody((current) => removeImageFromMarkdown(current, target.src));
    }
    dirtyRef.current = true;
  }, [imageMenu]);

  // Abre o campo de link ja com o link do clipboard, quando houver.
  const openLinkModal = useCallback(async () => {
    try {
      const text = (await Clipboard.getStringAsync()).trim();
      if (/^(https?:\/\/|www\.)\S+$/i.test(text)) setLinkValue(text);
    } catch {
      // clipboard indisponivel
    }
    setLinkOpen(true);
  }, []);

  const submitLink = useCallback(() => {
    const value = linkValue.trim();
    setLinkOpen(false);
    setLinkValue('');
    if (!value || !noteId) return;
    const url = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    editorRef.current?.insertLink(url);
    dirtyRef.current = true;
  }, [linkValue, noteId]);

  // Acao pedida pela tela inicial (texto/imagem/link): roda uma vez, quando o
  // editor termina de carregar, para reduzir passos dentro da nota.
  const handleEditorReady = useCallback(() => {
    if (focusOnEditRef.current) {
      focusOnEditRef.current = false;
      editorRef.current?.focus();
    }
    if (actionDoneRef.current || !noteId) return;
    actionDoneRef.current = true;
    mark('note.ready_ms', Date.now() - openedAt);
    if (editorMountRef.current) mark('note.webview_ms', Date.now() - editorMountRef.current);
    if (action === 'text') editorRef.current?.focus();
    else if (action === 'image') void handleAddImage();
    else if (action === 'link') void openLinkModal();
  }, [action, noteId, handleAddImage, openLinkModal, openedAt]);

  // Contagens varrem o texto inteiro: so recalcula quando o corpo ou a ficha
  // mudam (antes rodava a cada tecla e a cada re-render da nota).
  const { words, chars, totalBytes } = useMemo(
    () => ({
      words: countWords(body),
      chars: countChars(body),
      totalBytes: menuBytes + utf8ByteLength(markdownToPlain(body)),
    }),
    [body, menuBytes],
  );

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
          <Text style={styles.empty}>Nota não encontrada.</Text>
        </View>
      </Screen>
    );
  }

  const hasAudio = Boolean(note.filePath);
  // O primeiro audio da pilha e o proprio audio desta nota (o app que gravou e
  // subiu): o player local ja o mostra. Os demais vieram do dashboard e ganham
  // a sua linha. Sem audio local (nota criada no servidor), a pilha e inteira.
  const stackAudios = hasAudio ? stack.audios.slice(1) : stack.audios;
  const editorPlaceholder = hasAudio ? 'Escreva sobre este áudio...' : 'Comece a escrever...';
  // Em tela estreita o titulo comeca menor; em ambas quebra linha em vez de sumir.
  const titleSize = titleFontSize(title, windowWidth < 380 ? 30 : 34, 24);
  const properties: NoteProperty[] = [
    { label: 'Criada', value: formatDateTime(note.createdAt) },
    { label: 'Origem', value: hasAudio ? 'Audio' : 'Texto' },
    { label: 'Palavras', value: String(words) },
    { label: 'Caracteres', value: String(chars) },
    { label: 'Tamanho', value: formatBytes(totalBytes) },
    { label: 'Status', value: STATUS_META[note.status].label },
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
            accessibilityLabel="Gravar áudio"
          >
            <Ionicons name="mic-outline" size={22} color={colors.text} />
          </Pressable>
          <Pressable
            ref={configButtonRef}
            style={styles.circleButton}
            onPress={openMenu}
            accessibilityLabel="Configurações da nota"
          >
            <Ionicons name="ellipsis-horizontal" size={18} color={colors.text} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          editing ? styles.contentEditing : null,
          // Reserva a parte do teclado que a janela nao absorveu, para a ultima
          // linha conseguir subir acima dele.
          editing ? { paddingBottom: 96 + keyboardLift } : null,
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(event) => {
          scrollYRef.current = event.nativeEvent.contentOffset.y;
        }}
      >
        <TextInput
          value={title}
          onChangeText={handleTitleChange}
          placeholder="título da nota"
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.accent}
          multiline
          scrollEnabled={false}
          submitBehavior="blurAndSubmit"
          returnKeyType="next"
          onSubmitEditing={() => editorRef.current?.focus()}
          style={[
            styles.titleInput,
            { fontSize: titleSize, lineHeight: Math.round(titleSize * 1.25) },
          ]}
        />

        {hasAudio ? <NoteAudioPlayer player={player} durationMs={note.durationMs} /> : null}

        {stackAudios.length > 0 ? (
          <View style={styles.stack}>
            <Text style={styles.sectionLabel}>
              {stackAudios.length === 1 ? 'Áudio' : `${stackAudios.length} áudios`}
            </Text>
            {stackAudios.map((audio, index) => (
              <Pressable
                key={audio.id}
                style={[styles.stackRow, playingAudioId === audio.id ? styles.stackRowOn : null]}
                onPress={() => void playStackAudio(audio.id)}
                accessibilityRole="button"
                accessibilityLabel={`Ouvir áudio ${index + 1} de ${stackAudios.length}`}
              >
                <Ionicons
                  name={playingAudioId === audio.id ? 'pause' : 'play'}
                  size={16}
                  color={colors.textSecondary}
                />
                <View style={styles.stackInfo}>
                  <Text style={styles.stackTitle}>
                    {formatDateTime(audio.created_at)}
                    {audio.duration_seconds > 0
                      ? ` · ${formatDuration(Math.round(audio.duration_seconds))}`
                      : ''}
                  </Text>
                  {audio.transcript?.text ? (
                    <Text style={styles.stackText} numberOfLines={2}>
                      {audio.transcript.text}
                    </Text>
                  ) : (
                    <Text style={styles.stackText}>Sem transcrição</Text>
                  )}
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}

        {hasAudio && segments && segments.length > 0 ? (
          <SyncedTranscript
            player={player}
            segments={segments}
            onOpen={openTranscript}
            onSeek={seekTranscript}
          />
        ) : hasAudio && note.transcript && note.transcript.trim() ? (
          <Pressable
            style={styles.section}
            onPress={openTranscript}
            accessibilityLabel="Abrir transcrição completa"
          >
            <Text style={styles.sectionLabel}>Transcrição</Text>
            <Text style={styles.transcript} numberOfLines={6}>
              {breakSentences(note.transcript)}
            </Text>
          </Pressable>
        ) : hasAudio && !note.hasTranscript && note.transcriptStatus === 'pending' ? (
          <View style={styles.transcribing}>
            <ActivityIndicator size="small" color={colors.textSecondary} />
            <Text style={styles.meta}>
              Transcrevendo{transcriptionPercent > 0 ? ` ${Math.round(transcriptionPercent)}%` : '...'}
            </Text>
          </View>
        ) : null}

        {noteReady && settingsReady ? (
          editing ? (
            <View
              style={{ minHeight: editorMinHeight }}
              onLayout={(event) => {
                editorTopRef.current = event.nativeEvent.layout.y;
              }}
            >
              <RichEditor
                key={editorKey}
                ref={editorRef}
                value={body}
                onChangeMarkdown={handleBodyChange}
                onEditingChange={handleEditingChange}
                onReady={handleEditorReady}
                onCaret={handleCaret}
                onImageOpen={handleImageOpen}
                onImageMenu={handleImageMenu}
                onOpaqueMenu={handleOpaqueMenu}
                placeholder={editorPlaceholder}
                imageSources={imageSources}
                baseUrl={editorBaseUrl}
                typography={typography}
                minHeight={editorMinHeight}
                // Coluna de texto com medida e centralizada, como um documento.
                measure={Math.min(DEFAULT_MEASURE, Math.max(320, windowWidth - 2 * spacing.lg))}
              />
            </View>
          ) : (
            <NoteReader
              markdown={body}
              imageSources={imageSources}
              typography={typography}
              minHeight={editorMinHeight}
              placeholder={editorPlaceholder}
              onStartEditing={startEditing}
              onImageOpen={handleImageOpen}
              onImageMenu={(ref, width) => setImageMenu({ src: ref, width })}
            />
          )
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

      <ConflictDialog
        note={note}
        visible={conflictOpen}
        onKeepMine={handleKeepMine}
        onTakeTheirs={handleTakeTheirs}
        onDismiss={() => setConflictSnoozed(conflictKey)}
      />

      {editing ? (
        <View style={[styles.toolbar, { bottom: toolbarLift }]}>
          <ToolButton label="Negrito" onPress={() => editorRef.current?.format('bold')}>
            <Text style={styles.toolBold}>B</Text>
          </ToolButton>
          <ToolButton label="Itálico" onPress={() => editorRef.current?.format('italic')}>
            <Text style={styles.toolItalic}>I</Text>
          </ToolButton>
          <ToolButton label="Lista" onPress={() => editorRef.current?.format('list')}>
            <Ionicons name="list-outline" size={20} color={colors.text} />
          </ToolButton>
          <View style={styles.toolDivider} />
          <ToolButton label="Adicionar foto" onPress={() => void handleAddImage()}>
            <Ionicons name="image-outline" size={20} color={colors.text} />
          </ToolButton>
          <ToolButton label="Gravar áudio" onPress={handleRecord}>
            <Ionicons name="mic-outline" size={20} color={colors.text} />
          </ToolButton>
          <View style={styles.toolDivider} />
          <ToolButton label="Concluir edição" onPress={() => Keyboard.dismiss()}>
            <Ionicons name="checkmark" size={20} color={colors.accentStrong} />
          </ToolButton>
        </View>
      ) : null}

      <NoteMenu
        visible={menuOpen}
        title={title}
        properties={properties}
        analysis={
          note.entryId ? (analysisView ?? (analysisChecked ? null : undefined)) : undefined
        }
        anchor={menuAnchor}
        typography={typography}
        onChangeTypography={(next) => void setTypography(next)}
        onClose={() => setMenuOpen(false)}
        onShare={() => {
          setMenuOpen(false);
          void handleShare();
        }}
      />

      <FastModal visible={linkOpen} onRequestClose={() => setLinkOpen(false)}>
        <Pressable style={styles.linkBackdrop} onPress={() => setLinkOpen(false)}>
          <Pressable style={styles.linkCard} onPress={() => undefined}>
            <Text style={styles.linkTitle}>Adicionar link</Text>
            <TextInput
              value={linkValue}
              onChangeText={setLinkValue}
              placeholder="https://..."
              placeholderTextColor={colors.textTertiary}
              selectionColor={colors.accent}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              autoFocus
              onSubmitEditing={submitLink}
              style={styles.linkInput}
            />
            <View style={styles.linkActions}>
              <Pressable onPress={() => setLinkOpen(false)} accessibilityLabel="Cancelar">
                <Text style={styles.linkCancel}>Cancelar</Text>
              </Pressable>
              <Pressable onPress={submitLink} accessibilityLabel="Inserir link">
                <Text style={styles.linkConfirm}>Inserir</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </FastModal>

      <FastModal visible={viewerSrc != null} onRequestClose={closeViewer}>
        <Pressable style={styles.viewerBackdrop} onPress={closeViewer} accessibilityLabel="Fechar">
          {viewerSrc ? (
            <Image
              source={{ uri: viewerSrc }}
              style={styles.viewerImage}
              resizeMode="contain"
            />
          ) : null}
          <Pressable
            style={styles.viewerClose}
            onPress={closeViewer}
            accessibilityLabel="Fechar"
            hitSlop={10}
          >
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
        </Pressable>
      </FastModal>

      <FastModal visible={imageMenu != null} onRequestClose={closeImageMenu}>
        <Pressable style={styles.linkBackdrop} onPress={closeImageMenu}>
          <Pressable style={styles.linkCard} onPress={() => undefined}>
            <Text style={styles.linkTitle}>Imagem</Text>
            <Text style={styles.sectionLabel}>Tamanho</Text>
            {IMAGE_WIDTH_OPTIONS.map((option) => {
              const active = imageMenu?.width === option.percent;
              return (
                <Pressable
                  key={option.percent}
                  style={styles.sizeOption}
                  onPress={() => applyImageWidth(option.percent)}
                  accessibilityLabel={option.label}
                >
                  <View style={styles.sizePreviewTrack}>
                    <View style={[styles.sizePreviewFill, { width: `${option.percent}%` }]} />
                  </View>
                  <Text style={styles.sizeLabel}>{option.label}</Text>
                  {active ? (
                    <Ionicons name="checkmark" size={18} color={colors.accent} />
                  ) : null}
                </Pressable>
              );
            })}
            <Pressable style={styles.imageDelete} onPress={deleteImage} accessibilityLabel="Apagar">
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
              <Text style={styles.imageDeleteText}>Apagar</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </FastModal>
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
  contentEditing: { paddingBottom: 96 },
  titleInput: {
    color: colors.text,
    fontWeight: '700',
    paddingVertical: spacing.sm,
    textAlignVertical: 'top',
    backgroundColor: 'transparent',
  },
  meta: { color: colors.textSecondary, fontSize: fontSize.sm },
  transcribing: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  player: {
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
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
  linkBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  linkCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  linkTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  linkInput: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: fontSize.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  linkActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.xl },
  linkCancel: { color: colors.textSecondary, fontSize: fontSize.md },
  linkConfirm: { color: colors.accent, fontSize: fontSize.md, fontWeight: '700' },
  sizeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  sizePreviewTrack: {
    width: 48,
    height: 34,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    backgroundColor: colors.bgElevated,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  sizePreviewFill: {
    height: 22,
    borderRadius: radius.sm - 4,
    backgroundColor: colors.surfaceElevated,
  },
  sizeLabel: { color: colors.text, fontSize: fontSize.md, flex: 1 },
  imageDelete: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  imageDeleteText: { color: colors.danger, fontSize: fontSize.md },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerImage: { width: '100%', height: '100%' },
  viewerClose: {
    position: 'absolute',
    top: 56,
    right: spacing.lg,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  toolbar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  tool: { width: 44, height: 40, alignItems: 'center', justifyContent: 'center' },
  toolDivider: { width: StyleSheet.hairlineWidth, height: 22, backgroundColor: colors.border },
  stack: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.xs },
  stackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  stackRowOn: { backgroundColor: colors.surfaceElevated },
  stackInfo: { flex: 1, gap: 2 },
  stackTitle: { color: colors.text, fontSize: fontSize.sm },
  stackText: { color: colors.textTertiary, fontSize: fontSize.sm },
  toolBold: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800' },
  toolItalic: { color: colors.text, fontSize: fontSize.lg, fontWeight: '600', fontStyle: 'italic' },
});
