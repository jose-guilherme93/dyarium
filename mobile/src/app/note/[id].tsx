import { Ionicons } from '@expo/vector-icons';
import * as Battery from 'expo-battery';
import * as Clipboard from 'expo-clipboard';
import { useAudioPlayerStatus, type AudioPlayer as AudioPlayerHandle } from 'expo-audio';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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
import { NoteBody } from '@/components/NoteBody';
import type { NoteBodyHandle, NoteInsertPosition } from '@/components/noteBodyTypes';
import { NoteMetaRow } from '@/components/NoteMetaRow';
import { NoteMenu, type NoteMenuAnchor, type NoteProperty } from '@/components/NoteMenu';
import { NotebookPicker } from '@/components/NotebookPicker';
import { TagPicker } from '@/components/TagPicker';

import { Screen } from '@/components/Screen';
import { STATUS_META } from '@/components/StatusChip';
import { SyncedTranscript } from '@/components/SyncedTranscript';
import { simplifiedAnalysis, toNoteAnalysis, toServerAnalysis } from '@/core/analysis';
import type { AnalysisOutcome, AnalysisRun } from '@/core/analysisRuns';
import type { ServerAnalysis } from '@/core/api';
import { analysisModelById } from '@/core/analysisModels';
import { analysisContentHash } from '@/core/analysisPrompt';
import { localAnalysisEnabled } from '@/core/features';
import { newId } from '@/core/id';
import { DEFAULT_NOTEBOOK_ID } from '@/core/notebooks';
import { checkpointPercent } from '@/core/transcription';
import {
  formatBytes,
  formatDateTime,
  formatDuration,
  noteDateIso,
  noteDateLabel,
  titleFontSize,
  utf8ByteLength,
} from '@/core/format';
import { DEFAULT_IMAGE_WIDTH } from '@/core/image';
import { fontFamilyNative } from '@/core/typography';
import { appendAudioNodes, audioNodesForNote } from '@/core/noteAudio';
import { noteAudioNodes } from '@/core/noteDocument';
import { breakSentences, countChars, countWords, markdownToPlain } from '@/core/richText';
import type { Recording } from '@/core/types';
import { clearNoteConflict, keepMine } from '@/core/noteSync';
import { BUILD_STAMP, mark, useRenderCount } from '@/dev/perf';

import {
  attachmentUri,
  downloadMissingImageSources,
  localImageUri,
  resolveAudioSource,
  resolveImageSourcesLocal,
  saveLocalImage,
} from '@/services/attachments';
import { setPendingInsert } from '@/services/noteInsert';
import { fetchNoteAnalysis } from '@/services/analysis';
import { installedAnalysisModels, isAnalysisModelInstalled } from '@/services/analysisModels';
import { releaseAudioFocus } from '@/services/audioFocus';
import {
  getCachedAnalysis,
  getRecording,
  moveCachedAnalysis,
  saveAnalysisRuns,
  saveCachedAnalyses,
  upsertRecording,
  type CachedAnalysis,
} from '@/services/db';
import { directoryBytes, sessionDirectory } from '@/services/files';
import { pickImage } from '@/services/image';
import {
  analyzeRecording,
  analysisThreads,
  localAnalysisAvailable,
  stopAnalysis,
} from '@/services/localAnalysis';
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

/**
 * Corpo inicial da nota. Nota antiga (ou gravacao criada fora da tela) tinha o
 * audio em `filePath`/na pilha; aqui ele vira no do documento antes do editor
 * montar, sem um quadro com o player legado no topo.
 */
function bodyWithAudioNodes(note: Recording): string {
  const stored = note.text ?? '';
  if (noteAudioNodes(stored).length > 0) return stored;
  return appendAudioNodes(stored, audioNodesForNote(note));
}

/**
 * Player do audio da nota. Memoizado: digitar o titulo re-renderiza a tela, mas
 * nao precisa refazer o player (ele mesmo assina o status do audio).
 */
const NoteAudioPlayer = memo(function NoteAudioPlayer({
  player,
  durationMs,
}: {
  player: PlayerHandle;
  durationMs?: number;
}) {
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
});

/**
 * Previa do texto enquanto o editor carrega. O corpo da nota aparece junto com
 * a tela, no mesmo lugar e com a mesma tipografia; quando o editor fica pronto
 * ele toma o lugar, sem a nota abrir "vazia" por um instante.
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
  const navigation = useNavigation();
  const library = useLibrary();
  const {
    typography,
    setTypography,
    analysisModel,
    setAnalysisModel,
    analysisLowPower,
    setAnalysisLowPower,
  } = useSettings();
  // Enquanto esta tela esta viva, a sincronizacao de fundo espera: a nota e
  // local e nao pode disputar SQLite/rede com o que o usuario esta fazendo.
  // Ao sair, a fila volta na hora: sem este kick o envio so acontecia no
  // intervalo de 15 s (ou quando o app ia para segundo plano).
  const kickRef = useRef(library.kick);
  useEffect(() => {
    kickRef.current = library.kick;
  }, [library.kick]);
  useEffect(() => {
    enterNote();
    // A fila volta a andar no fim da saida, depois do texto ser gravado (ver o
    // efeito de saida): disparar aqui disputava o SQLite com o ultimo autosave.
    return () => leaveNote();
  }, []);
  const { width: windowWidth } = useWindowDimensions();
  const note = useMemo(
    () => library.recordings.find((r) => r.id === id),
    [library.recordings, id],
  );
  const noteTags = useMemo(() => note?.tags ?? [], [note?.tags]);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  // A lista de tags conhecidas varre todas as notas. So vale a pena quando o
  // seletor esta aberto: abrir/rolar a nota nao pode pagar essa varredura.
  const knownTags = useMemo(() => {
    if (!tagPickerOpen) return [];
    const seen = new Set<string>();
    const tags: string[] = [];
    for (const recording of library.recordings) {
      for (const tag of recording.tags ?? []) {
        const key = tag.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        tags.push(tag);
      }
    }
    return tags.sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
  }, [library.recordings, tagPickerOpen]);
  const noteId = note?.id;
  const liveTranscriptionPercent = useTranscriptionProgress(noteId);
  const transcriptionPercent =
    liveTranscriptionPercent > 0
      ? liveTranscriptionPercent
      : checkpointPercent(note ?? {});
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
  const [body, setBody] = useState(() => (note ? bodyWithAudioNodes(note) : ''));
  // Corpo trocado por fora ("ficar com o de la"): o editor monta uma vez com o
  // markdown que recebe, entao remontar e o que aplica o texto novo.
  const [editorKey, setEditorKey] = useState(0);
  // As imagens que ja estao no aparelho entram no primeiro render: se elas
  // chegassem depois, cada trecho com foto inline remontaria o editor na
  // abertura. As que faltam baixam em segundo plano e entram quando chegam.
  const [imageSources, setImageSources] = useState<Record<string, string>>({});
  const [notebookPickerOpen, setNotebookPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<NoteMenuAnchor | null>(null);
  const [menuBytes, setMenuBytes] = useState(0);
  // Analise ja feita no servidor: o cache aparece na hora e a rede so atualiza.
  const [cachedAnalysis, setCachedAnalysis] = useState<CachedAnalysis | null>(null);
  // Diferencia "ainda nao verifiquei" de "verifiquei e nao ha analise": a
  // secao nao pisca "sem analise" enquanto o refresh silencioso acontece.
  const [analysisChecked, setAnalysisChecked] = useState(false);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisInput, setAnalysisInput] = useState<{ body: number; transcript: number } | null>(
    null,
  );
  // Estatisticas ao vivo: tempo, tokens/s (CPU trabalhando) e bateria.
  const [analysisLive, setAnalysisLive] = useState<{
    elapsedMs: number;
    tokens: number;
    battery: number | null;
  } | null>(null);
  const [analysisLast, setAnalysisLast] = useState<{
    elapsedMs: number;
    tokensPerSecond: number;
    batteryDelta: number | null;
    threads: number;
  } | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const analysisTokensRef = useRef(0);
  const analysisBatteryStartRef = useRef<number | null>(null);
  const stopRequestedRef = useRef(false);
  const analysisBusyRef = useRef(false);
  /** Parar a analise local quando a tela perde o foco (definido abaixo). */
  const stopAnalysisOnLeaveRef = useRef<() => void>(() => undefined);
  // A analise local nasce antes do upload: ate o entryId existir, a chave e o
  // id da gravacao; depois ela e movida para a chave definitiva do servidor.
  const analysisKey = note?.entryId ?? note?.id ?? '';
  // `isAnalysisModelInstalled` lista/estatiza os modelos: so vale a pena quando
  // o menu (que mostra o aviso) vai abrir, nunca no caminho de abrir a nota.
  const localAnalysisReady = useMemo(
    () =>
      menuOpen &&
      localAnalysisEnabled() &&
      localAnalysisAvailable() &&
      isAnalysisModelInstalled(analysisModel),
    [analysisModel, menuOpen],
  );
  const analysisView = useMemo(
    () =>
      cachedAnalysis && cachedAnalysis.entryId === analysisKey
        ? toNoteAnalysis(cachedAnalysis.analysis)
        : null,
    [cachedAnalysis, analysisKey],
  );
  // A analise guardada e de uma versao anterior do texto? So a local tem hash.
  const analysisSimplified = cachedAnalysis?.analysis.model === 'local-fallback';
  const analysisStale = useMemo(() => {
    if (cachedAnalysis?.origin !== 'local' || !cachedAnalysis.contentHash) return false;
    const current = analysisContentHash({
      title: title.trim() || (note?.title ?? ''),
      text: body,
    });
    return current !== cachedAnalysis.contentHash;
  }, [cachedAnalysis, title, body, note?.title]);

  // Enquanto analisa, mostra o tempo, os tokens/s (CPU) e a bateria atual.
  useEffect(() => {
    if (!analysisBusy) return;
    const started = Date.now();
    let alive = true;
    const tick = () => {
      if (!alive) return;
      setAnalysisLive((current) => ({
        elapsedMs: Date.now() - started,
        tokens: analysisTokensRef.current,
        battery: current?.battery ?? analysisBatteryStartRef.current ?? null,
      }));
    };
    tick();
    const timer = setInterval(tick, 1000);
    const batteryTimer = setInterval(() => {
      void Battery.getBatteryLevelAsync()
        .then((level) => {
          if (!alive) return;
          setAnalysisLive((current) =>
            current ? { ...current, battery: level >= 0 ? level : current.battery } : current,
          );
        })
        .catch(() => undefined);
    }, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
      clearInterval(batteryTimer);
    };
  }, [analysisBusy]);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [viewerSrc, setViewerSrc] = useState<string | null>(null);
  const configButtonRef = useRef<View>(null);
  /**
   * Altura do teclado.
   *
   * O app usa `adjustNothing` (o plugin nativo), entao e ele que reserva o
   * espaco do teclado para a barra de acoes nao ficar coberta. A nota NAO rola
   * sozinha: quem cuida do cursor e o Android, e rolar para o topo do trecho
   * (medido pelo bloco, nao pelo cursor) fazia a nota pular sem motivo.
   */
  const [keyboardPad, setKeyboardPad] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardPad(event.endCoordinates.height);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardPad(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const initializedRef = useRef(false);  const actionDoneRef = useRef(false);
  const dirtyRef = useRef(false);
  const editingRef = useRef(false);
  const leavingRef = useRef(false);
  const bodyRef = useRef(body);
  const bodySaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Autosave pendente.
   *
   * Separado do timer: o timer morre quando dispara, mas a gravacao ainda pode
   * estar na fila. Enquanto houver gravacao pendente, uma versao que chega do
   * servidor nao pode remontar o editor.
   */
  const savePendingRef = useRef(false);
  /**
   * Fila de gravacoes da nota.
   *
   * O autosave do texto, o do titulo e a saida chamam `updateNote`; em paralelo,
   * cada chamada le e escreve a mesma linha no SQLite e a segunda encontra o
   * banco ocupado ("database is locked"). Uma fila por tela mantem a ordem e
   * entrega o texto mais novo por ultimo.
   */
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const titleRef = useRef(title);
  useEffect(() => {
    titleRef.current = title;
  }, [title]);
  const editorRef = useRef<NoteBodyHandle>(null);
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
  // Espera o editor entregar o HTML pendente antes de desmontar/navegar. O teto
  // evita travar a tela se o evento se perder.
  const flushEditor = useCallback(async () => {
    const flush = editorRef.current?.flush;
    if (!flush) return;
    await Promise.race([
      flush().catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 300)),
    ]);
  }, []);

  /**
   * Grava titulo/texto em fila.
   *
   * Serializa as gravacoes da nota (autosave do texto, do titulo e saida) para
   * nao haver duas leituras+escritas concorrentes da mesma linha no SQLite.
   * Erro de gravacao e best-effort: o texto continua em memoria e a saida
   * tenta de novo.
   */
  const saveNote = useCallback(
    (patch: { title?: string; text?: string }) => {
      if (!noteId) return Promise.resolve();
      const id = noteId;
      savePendingRef.current = true;
      const run = saveChainRef.current
        .then(() => updateRef.current(id, patch))
        .catch(() => undefined)
        .then(() => {
          savePendingRef.current = false;
        });
      saveChainRef.current = run;
      return run;
    },
    [noteId],
  );



  // Volta por gesto/tecla do sistema nao passa pelo `goBack`: espera o editor
  // entregar as ultimas teclas antes de desmontar a nota. O `goBack` da tela ja
  // faz o flush e marca `leavingRef`, entao o listener apenas libera a acao.
  const flushingBackRef = useRef(false);
  const replayRemovalRef = useRef(false);
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (replayRemovalRef.current || leavingRef.current) return;
      event.preventDefault();
      if (flushingBackRef.current) return;
      flushingBackRef.current = true;
      // Fecha o teclado antes de a view nativa ser destruida (desmontar um
      // campo aberto travava a thread de UI na transicao).
      editorRef.current?.blur?.();
      Keyboard.dismiss();
      void flushEditor().finally(() => {
        replayRemovalRef.current = true;
        navigation.dispatch(event.data.action);
      });
    });
    return unsubscribe;
  }, [flushEditor, navigation]);
  // Handlers estaveis: o editor (memoizado) nao pode re-renderizar a cada tecla.
  const handleTitleChange = useCallback((value: string) => {
    dirtyRef.current = true;
    // O titulo quebra linha visualmente, mas continua sendo uma linha logica.
    setTitle(value.replace(/\n/g, ' '));
  }, []);

  const handleBodyChange = useCallback(
    (markdown: string) => {
      // O editor reemite o conteudo ao montar, normalizado (sem espacos no fim).
      // Isso nao e edicao: sem o guarda, abrir a nota a marcava como suja e o sync
      // reenviava o texto local por cima do que foi editado no dashboard.
      if (markdown.trimEnd() === bodyRef.current.trimEnd()) {
        // So mudou o espaco do fim: o texto e o mesmo, mas o registro precisa
        // acompanhar, senao o editor e reescrito e o cursor do usuario se
        // perde.
        bodyRef.current = markdown;
        return;
      }
      dirtyRef.current = true;
      bodyRef.current = markdown;
      // Nao atualiza `body` durante a digitacao: o estado da tela re-renderiza o
      // cabeçalho, contadores e a barra, competindo com o editor nativo. A tela
      // usa `bodyRef` para salvar e so materializa o estado ao sair do editor.
      if (bodySaveTimer.current) clearTimeout(bodySaveTimer.current);
      savePendingRef.current = true;
      bodySaveTimer.current = setTimeout(() => {
        bodySaveTimer.current = null;
        void saveNote({ title: titleRef.current, text: bodyRef.current });
      }, 1200);
    },
    [saveNote],
  );

  // Perder o foco entrega o texto pendente.
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

  /**
   * Tira o foco do editor antes de sair.
   *
   * Desmontar um campo nativo com o teclado aberto travava a thread de UI na
   * transicao ("pisca tudo preto"/ANR). Fechar o teclado primeiro libera a
   * conexao de input antes de a view ser destruida.
   */
  const blurEditor = useCallback(() => {
    editorRef.current?.blur?.();
    Keyboard.dismiss();
  }, []);

  const goBack = useCallback(() => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    blurEditor();
    void flushEditor().finally(() => {
      if (router.canGoBack()) router.back();
      else router.replace('/');
    });
  }, [blurEditor, flushEditor]);

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
    // Enquanto o usuario digita (ou o autosave local esta pendente), o texto
    // local vence. Aplicar uma versao do servidor aqui remontava o editor e
    // jogava o cursor para o comeco do texto.
    if (editingRef.current || savePendingRef.current || bodySaveTimer.current) return;
    if (note.bodyVersion === shownBodyVersion.current) return;
    shownBodyVersion.current = note.bodyVersion;
    if ((note.text ?? '') === bodyRef.current) return;
    setBody(note.text ?? '');
    setEditorKey((value) => value + 1);
  }, [note]);

  // Ao voltar de outra tela (gravacao, por exemplo), a nota pode ter ganhado um
  // no novo no corpo. Reler do banco e remontar o editor e o que mostra o audio
  // entre os textos, sem esperar a proxima abertura.
  //
  // So depois de a tela ter saido de foco: no primeiro foco (logo apos montar)
  // o banco ainda tem o texto anterior a migracao do audio para o corpo, e
  // reidratar ali remontava o documento inteiro logo na abertura.
  useEffect(() => {
    if (!noteId) return undefined;
    let wentAway = false;
    const unsubscribeBlur = navigation.addListener('blur', () => {
      wentAway = true;
      // A analise local divide a CPU com a interface: sair da nota para
      // qualquer lugar a interrompe, em vez de deixar a navegacao lenta.
      stopAnalysisOnLeaveRef.current();
    });
    const unsubscribeFocus = navigation.addListener('focus', () => {
      if (!wentAway) return;
      wentAway = false;
      void getRecording(noteId)
        .then((fresh) => {
          if (!fresh) return;
          const text = fresh.text ?? '';
          if (text === bodyRef.current) {
            // O texto nao mudou: a gravacao foi cancelada e o corpo continua
            // como esta.
            return;
          }
          // A tela volta com o editor aberto (a gravacao abriu por cima dele).
          // O texto do banco e o da gravacao: ele tem prioridade sobre o que
          // esta no editor, senao o audio nao apareceria no corpo.
          editingRef.current = false;
          // O autosave pendente gravaria o texto antigo (sem o audio) por
          // cima: ele e cancelado.
          if (bodySaveTimer.current) {
            clearTimeout(bodySaveTimer.current);
            bodySaveTimer.current = null;
          }
          savePendingRef.current = false;
          bodyRef.current = text;
          setBody(text);
          setEditorKey((value) => value + 1);
        })
        .catch(() => undefined);
    });
    return () => {
      unsubscribeBlur();
      unsubscribeFocus();
    };
  }, [navigation, noteId]);

  // Fonte de cada audio do documento: arquivo local da nota ou anexo do
  // servidor. Resolvido so quando o usuario toca em tocar.
  const resolveAudio = useCallback(
    (ref: string) => resolveAudioSource(noteId ?? '', ref, note?.attachments ?? {}),
    [note?.attachments, noteId],
  );

  // Transcricao de cada audio, por referencia. A pilha do servidor traz a de
  // cada anexo; a gravacao local usa a transcricao da propria nota.
  const audioTranscripts = useMemo(() => {
    const map: Record<string, string> = {};
    // A pilha e revalidada em segundo plano; usar o estado dela (e nao so o
    // cache da nota) faz a transcricao aparecer no card assim que chega.
    for (const audio of stack.audios) {
      const text = audio.transcript?.text?.trim();
      if (text) map[`attachment:${audio.id}`] = text;
    }
    const localName = note?.filePath?.split('/').pop()?.split('?')[0];
    if (localName && note?.transcript?.trim()) {
      map[`local:${localName}`] = note.transcript.trim();
    }
    if (note?.serverAttachmentId && note.transcript?.trim()) {
      map[`attachment:${note.serverAttachmentId}`] = note.transcript.trim();
    }
    return map;
  }, [note, stack.audios]);

  // As imagens que faltam baixam em segundo plano. Agrupa os avisos num unico
  // render: varias fotos chegando juntas nao devem re-renderizar a nota varias
  // vezes seguidas.
  const pendingImageSourcesRef = useRef<Record<string, string>>({});
  const imageSourcesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueImageSource = useCallback((ref: string, uri: string) => {
    pendingImageSourcesRef.current[ref] = uri;
    if (imageSourcesTimerRef.current) return;
    imageSourcesTimerRef.current = setTimeout(() => {
      imageSourcesTimerRef.current = null;
      const next = pendingImageSourcesRef.current;
      pendingImageSourcesRef.current = {};
      setImageSources((current) => ({ ...current, ...next }));
    }, 50);
  }, []);
  useEffect(
    () => () => {
      if (imageSourcesTimerRef.current) clearTimeout(imageSourcesTimerRef.current);
    },
    [],
  );

  // Resolve as imagens que ja estao no aparelho de forma sincrona e monta a
  // leitura na hora. As que faltam baixam em segundo plano e entram quando
  // chegam: a nota nunca fica presa esperando uma foto.
  useEffect(() => {
    if (note && !initializedRef.current) {
      initializedRef.current = true;
      setTitle(note.title);
      // Nota antiga (ou gravacao criada fora da tela): o audio vivia em
      // `filePath`/na pilha do servidor. Ele vira no do corpo na primeira
      // abertura, que e o que faz o player aparecer entre os textos.
      const migrated = bodyWithAudioNodes(note);
      setBody(migrated);
      bodyRef.current = migrated;
      const attachments = note.attachments ?? {};
      // As fotos locais entram depois do primeiro frame (checar arquivo no
      // disco nao pode atrasar a abertura); as que faltam baixam em seguida.
      setImageSources(resolveImageSourcesLocal(note.id, migrated, attachments));
      mark('note.ready_ms', Date.now() - openedAt);
      mark('note.images_ms', Date.now() - openedAt);
      if (__DEV__) {
        console.log('[perf] note.corpo', {
          bundle: BUILD_STAMP,
          chars: (note.text ?? '').length,
          linhas: (note.text ?? '').split('\n').length,
          fotos: Object.keys(attachments).length,
        });
      }
      void downloadMissingImageSources(note.id, migrated, attachments, queueImageSource).catch(
        () => undefined,
      );
    }
  }, [note, openedAt, queueImageSource]);

  // A transcricao local (Whisper) nao roda aqui: ela satura a CPU do aparelho
  // e trava a nota aberta (o quadro cai de 17 ms para segundos). Quem transcreve
  // em segundo plano e o app fechado, pela task de background.

  // Autosave local (debounced). A montagem nao grava: abrir uma nota nao pode
  // virar escrita no banco (e a nota nem mudou).
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!noteId) return undefined;
    if (!mountedRef.current) {
      mountedRef.current = true;
      return undefined;
    }
    const timer = setTimeout(() => {
      void saveNote({ title: titleRef.current, text: bodyRef.current });
    }, 600);
    return () => clearTimeout(timer);
  }, [title, body, noteId, saveNote]);

  // Ao sair: grava e envia. Roda so depois da transicao de volta, para o trabalho
  // (DB, enqueue, rede) nao competir com a animacao nem com o desmonte das
  // views nativas da nota.
  useEffect(() => {
    if (!noteId) return undefined;
    const id = noteId;
    return () => {
      if (bodySaveTimer.current) {
        clearTimeout(bodySaveTimer.current);
        bodySaveTimer.current = null;
      }
      const title = titleRef.current;
      const text = bodyRef.current;
      const dirty = dirtyRef.current;
      const status = statusRef.current;
      const timer = setTimeout(() => {
        // Entra na mesma fila dos autosaves: a gravacao de saida e a ultima e
        // nao pode correr em paralelo com uma que ainda esta indo para o banco.
        void saveChainRef.current
          .then(() => updateRef.current(id, { title, text }))
          .then(() => {
            if (dirty || status === 'draft') return submitRef.current(id);
            return undefined;
          })
          .then(() => refreshRef.current())
          .then(() => kickRef.current())
          .catch(() => undefined);
      }, 0);
      // O timer nao e cancelado no unmount (a tela ja saiu): o trabalho
      // continua e a fila de sync assume.
      void timer;
    };
  }, [noteId]);

  // Analise: le o cache do aparelho assim que a nota abre (offline-first) e so
  // busca a versao do servidor quando o menu abre, sem gerar nada.
  const localNoteId = note?.id;
  const noteEntryId = note?.entryId;
  useEffect(() => {
    if (!localNoteId) return;
    let alive = true;
    void (async () => {
      let item: CachedAnalysis | null = null;
      if (noteEntryId) {
        const definitive = await getCachedAnalysis(noteEntryId);
        const pending = await getCachedAnalysis(localNoteId);
        if (pending?.origin === 'local') {
          if (definitive?.origin === 'local') {
            item = definitive;
          } else {
            // Analise local feita antes do upload: ela vence e passa a morar na
            // chave definitiva.
            await moveCachedAnalysis(localNoteId, noteEntryId);
            item = { ...pending, entryId: noteEntryId };
          }
        } else {
          item = definitive ?? pending;
        }
      } else {
        item = await getCachedAnalysis(localNoteId);
      }
      if (alive) setCachedAnalysis(item);
    })()
      .catch(() => {
        // Cache local e best-effort: sem ele a ficha fica sem analise.
      })
      .finally(() => {
        if (alive) setAnalysisChecked(true);
      });
    return () => {
      alive = false;
    };
  }, [localNoteId, noteEntryId]);

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
    // Analise local e a fonte principal: o servidor nao sobrescreve.
    if (cachedAnalysis?.origin === 'local') {
      setAnalysisChecked(true);
      return;
    }
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
  }, [note, title, cachedAnalysis?.origin]);

  // Analise sob demanda no aparelho: nada de rede e nada de texto saindo daqui.
  const handleAnalyzeLocal = useCallback(async () => {
    const target = note;
    if (!target || analysisBusy) return;
    // Diagnostico sem conteudo: so os booleanos que decidem o botao.
    console.log('[analysis] press', {
      available: localAnalysisAvailable(),
      model: analysisModel,
      installed: isAnalysisModelInstalled(analysisModel),
    });
    if (!localAnalysisAvailable()) {
      setAnalysisError(
        'Este build não tem o motor de análise local. Instale o development build mais recente.',
      );
      return;
    }
    // Usa o modelo escolhido; se ele nao estiver baixado, cai para qualquer
    // modelo instalado em vez de deixar o botao sem resposta.
    const selected = analysisModelById(analysisModel);
    const installed = installedAnalysisModels().map((item) => item.id);
    const model =
      selected && installed.includes(selected.id)
        ? selected
        : installed.length > 0
          ? analysisModelById(installed[0])
          : null;
    if (!model) {
      setAnalysisError('Baixe um modelo de análise em Ajustes > Transcrição e modelos.');
      return;
    }
    if (model.id !== analysisModel) {
      void setAnalysisModel(model.id).catch(() => undefined);
    }
    // Usa o que esta na tela agora, nao a copia que a biblioteca carregou:
    // o texto digitado ainda pode nao ter sido salvo, e a analise precisa dele.
    const liveTitle = titleRef.current.trim() || target.title;
    const liveBody = bodyRef.current;
    const key = target.entryId ?? target.id;
    setAnalysisError(null);
    setAnalysisInput(null);
    setAnalysisLast(null);
    analysisTokensRef.current = 0;
    analysisBatteryStartRef.current = null;
    setAnalysisLive({ elapsedMs: 0, tokens: 0, battery: null });
    void Battery.getBatteryLevelAsync()
      .then((level) => {
        if (level < 0) return;
        analysisBatteryStartRef.current = level;
        setAnalysisLive((current) => (current ? { ...current, battery: level } : current));
      })
      .catch(() => undefined);
    stopRequestedRef.current = false;
    setAnalysisBusy(true);
    // Diagnostico da execucao: uma linha por tentativa, gravada no finally.
    const pendingRuns: AnalysisRun[] = [];
    const recordRun = (run: Omit<AnalysisRun, 'id' | 'entryId'>) => {
      pendingRuns.push({ ...run, id: newId('run_'), entryId: key });
    };
    try {
      // Le a transcricao mais nova do banco; a copia em memoria pode estar
      // atrasada. Se a nota veio do servidor com varios audios, junta o texto
      // de todos eles.
      const fresh = await getRecording(target.id).catch(() => null);
      const audioTranscripts = (fresh?.serverAudios ?? [])
        .map((audio) => audio.transcript?.text?.trim() ?? '')
        .filter(Boolean)
        .join('\n\n');
      const liveTranscript = (fresh?.transcript?.trim() || audioTranscripts).trim();
      // Texto que sobra depois de tirar markdown (foto/link nao sao texto).
      const plainBody = markdownToPlain(liveBody).trim();
      const imageCount = (liveBody.match(/!\[[^\]]*\]\([^)]*\)/g) ?? []).length;
      console.log('[analysis] input', {
        title: liveTitle.length,
        body: liveBody.length,
        plainBody: plainBody.length,
        transcript: liveTranscript.length,
        images: imageCount,
        savedBody: (target.text ?? '').length,
      });
      setAnalysisInput({ body: plainBody.length, transcript: liveTranscript.length });
      if (!plainBody && !liveTranscript.trim()) {
        setAnalysisError('Esta nota ainda não tem texto ou transcrição para analisar.');
        return;
      }
      const input = { ...target, title: liveTitle, text: liveBody, transcript: liveTranscript };
      const inputText = [plainBody, liveTranscript].filter(Boolean).join('\n\n');
      const contentHash = analysisContentHash({ title: liveTitle, text: liveBody });
      let lastRun: Awaited<ReturnType<typeof analyzeRecording>> | null = null;
      let analysis: ServerAnalysis | null = null;
      const loopStarted = new Date();

      // Duas tentativas: a primeira usa o contexto carregado (rapida); a
      // segunda recarrega o modelo do zero. Se as duas falharem, a nota ainda
      // sai analisada pela leitura simplificada.
      for (let attempt = 0; attempt < 2 && !stopRequestedRef.current; attempt += 1) {
        analysisTokensRef.current = 0;
        const attemptStarted = new Date();
        try {
          const result = await analyzeRecording(input, model, {
            fresh: attempt > 0,
            lowPower: analysisLowPower,
            onToken: () => {
              analysisTokensRef.current += 1;
            },
          });
          lastRun = result;
          console.log('[analysis] attempt', {
            attempt,
            parsed: Boolean(result.parsed),
            ms: result.run.wallMs,
            chars: result.run.text.length,
            reading: Boolean(result.parsed?.reading),
            themes: result.parsed?.themes.length ?? 0,
            emotions: result.parsed?.emotions.length ?? 0,
          });
          const candidate = result.parsed ? toServerAnalysis(result.parsed, model.id) : null;
          const accepted = candidate ? toNoteAnalysis(candidate) !== null : false;
          if (accepted && candidate) analysis = candidate;
          const outcome: AnalysisOutcome = accepted ? 'ok' : 'invalid_json';
          recordRun({
            runtime: 'local',
            provider: 'llama.cpp',
            model: model.id,
            attempt: attempt + 1,
            outcome,
            startedAt: attemptStarted.toISOString(),
            finishedAt: new Date().toISOString(),
            durationMs: result.run.wallMs,
            inputTextChars: plainBody.length,
            inputTranscriptChars: liveTranscript.length,
            inputImages: imageCount,
            promptTokens: result.run.timings?.promptTokens ?? 0,
            completionTokens: result.run.timings?.predictedTokens ?? 0,
            tokensPerSecond: result.run.timings?.predictedPerSecond ?? 0,
            threads: analysisThreads(analysisLowPower),
          });
          if (accepted) break;
        } catch (error) {
          recordRun({
            runtime: 'local',
            provider: 'llama.cpp',
            model: model.id,
            attempt: attempt + 1,
            outcome: stopRequestedRef.current ? 'stopped' : 'error',
            errorClass: 'engine',
            startedAt: attemptStarted.toISOString(),
            finishedAt: new Date().toISOString(),
            durationMs: Math.max(0, Date.now() - attemptStarted.getTime()),
            inputTextChars: plainBody.length,
            inputTranscriptChars: liveTranscript.length,
            inputImages: imageCount,
            promptTokens: 0,
            completionTokens: 0,
            tokensPerSecond: 0,
            threads: analysisThreads(analysisLowPower),
          });
          console.warn(
            '[analysis] tentativa falhou',
            attempt,
            error instanceof Error ? error.message : 'erro desconhecido',
          );
        }
      }
      if (stopRequestedRef.current) {
        setAnalysisError('Análise interrompida.');
        return;
      }
      if (
        !analysis &&
        cachedAnalysis?.origin === 'local' &&
        cachedAnalysis.contentHash === contentHash
      ) {
        // A nota nao mudou: preserva a analise boa em vez de degradar para a
        // leitura simplificada.
        analysis = cachedAnalysis.analysis;
        setAnalysisError('Não foi possível refazer a análise; a anterior foi mantida.');
      }
      if (!analysis) {
        // Garantia: havendo texto ou transcricao, a nota nao fica sem resposta.
        analysis = simplifiedAnalysis(inputText);
        recordRun({
          runtime: 'local',
          provider: 'lexical',
          model: 'local-fallback',
          attempt: 0,
          outcome: 'fallback',
          startedAt: loopStarted.toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 0,
          inputTextChars: plainBody.length,
          inputTranscriptChars: liveTranscript.length,
          inputImages: imageCount,
          promptTokens: 0,
          completionTokens: 0,
          tokensPerSecond: 0,
        });
        console.log('[analysis] fallback', { model: analysis.model });
      }
      const item: CachedAnalysis = {
        entryId: key,
        title: title.trim() || target.title,
        recordedAt: target.recordedAt,
        origin: 'local',
        contentHash,
        analysis,
      };
      // Mostra o resultado na hora: a gravacao no SQLite nao pode segurar a
      // interface (uma transacao concorrente ja travou essa espera antes).
      setCachedAnalysis(item);
      setAnalysisChecked(true);
      const endLevel = await Battery.getBatteryLevelAsync().catch(() => -1);
      const startLevel = analysisBatteryStartRef.current;
      const batteryDelta =
        startLevel !== null && endLevel >= 0 ? (endLevel - startLevel) * 100 : null;
      if (pendingRuns.length > 0 && batteryDelta !== null) {
        pendingRuns[pendingRuns.length - 1].batteryDeltaPct = batteryDelta;
      }
      if (lastRun) {
        setAnalysisLast({
          elapsedMs: lastRun.run.wallMs,
          tokensPerSecond: lastRun.run.timings?.predictedPerSecond ?? 0,
          batteryDelta,
          threads: analysisThreads(analysisLowPower),
        });
      }
      void saveCachedAnalyses([item]).catch(() => {
        setAnalysisError('Análise feita, mas não foi possível guardar no aparelho.');
      });
    } catch (error) {
      // Sem conteudo no log: so a mensagem tecnica do motor.
      console.warn(
        '[analysis] falhou',
        error instanceof Error ? error.message : 'erro desconhecido',
      );
      setAnalysisError('Não foi possível analisar esta nota no aparelho.');
    } finally {
      if (pendingRuns.length > 0) {
        void saveAnalysisRuns(pendingRuns).catch(() => {
          console.warn('[analysis] diagnostico nao gravado');
        });
      }
      setAnalysisBusy(false);
      setAnalysisLive(null);
    }
  }, [
    note,
    analysisBusy,
    analysisModel,
    analysisLowPower,
    cachedAnalysis,
    setAnalysisModel,
    title,
  ]);

  const handleStopAnalysis = useCallback(() => {
    stopRequestedRef.current = true;
    void stopAnalysis();
  }, []);

  useEffect(() => {
    analysisBusyRef.current = analysisBusy;
  }, [analysisBusy]);

  useEffect(() => {
    stopAnalysisOnLeaveRef.current = () => {
      if (!analysisBusyRef.current) return;
      handleStopAnalysis();
    };
  }, [handleStopAnalysis]);

  // Ficha da nota: soma os arquivos locais ao abrir o menu e mede o botao para
  // ancorar o popover logo abaixo dele.
  const openMenu = useCallback(() => {
    // O menu mostra contadores/propriedades: materializa o corpo mais novo que
    // ficou em `bodyRef` durante a digitacao. Sem mudanca, o estado atual fica:
    // trocar a identidade remontaria todas as views do corpo a toa.
    setBody((current) => (current === bodyRef.current ? current : bodyRef.current));
    // Somar arquivos lista a pasta da nota: faz depois da animacao do popover,
    // nao no caminho do toque.
    if (noteId) {
      setTimeout(() => {
        setMenuBytes(directoryBytes(sessionDirectory(noteId)));
      }, 50);
    }
    // Sem cache, esconde a secao durante o refresh silencioso: nada de
    // "sem analise" piscando antes da resposta. Com a analise local ligada a
    // secao ja nasce visivel por causa do botao.
    if (!cachedAnalysis && !localAnalysisEnabled()) setAnalysisChecked(false);
    setAnalysisError(null);
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
    // O cursor define onde a gravacao entra no corpo. Sem cursor de texto, o
    // audio entra no fim da nota.
    const openRecord = (at: NoteInsertPosition | null) => {
      // A posicao fica guardada por nota, e a rota leva so o id: a gravacao
      // acontece em outra tela.
      if (at) setPendingInsert(noteId, at);
      router.push({
        pathname: '/record',
        params: { noteId, from: 'note' },
      });
    };
    // O texto pendente vai para o banco antes da posicao ser pedida: a
    // posicao tem que valer para o texto que vai ficar salvo, e nao para o
    // de antes do flush.
    void flushEditor()
      .then(() =>
        saveNote({
          title: titleRef.current,
          text: bodyRef.current,
        }),
      )
      .catch(() => undefined)
      .then(() => Promise.resolve(editorRef.current?.getInsertPosition() ?? null))
      .then((at) => openRecord(at))
      .catch(() => openRecord(null));
  }, [flushEditor, noteId, saveNote]);

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
    try {
      const picked = await pickImage();
      if (!picked) return;
      // Salva e insere local na hora. O upload fica para o sync ao sair da
      // nota: esperar a rede aqui deixava o seletor fechado e a nota travada.
      const name = await saveLocalImage(noteId, picked.bytes, picked.mimeType);
      const displaySrc = localImageUri(noteId, name);
      if (!displaySrc) throw new Error('arquivo local da imagem indisponivel');
      const persistSrc = `local:${name}`;
      // A previa precisa saber que esta referencia aponta para o arquivo local;
      // o markdown em si carrega so `local:`/`attachment:`.
      setImageSources((current) => ({ ...current, [persistSrc]: displaySrc }));
      editorRef.current?.insertImage(
        displaySrc,
        persistSrc,
        picked.name,
        DEFAULT_IMAGE_WIDTH,
        picked.width,
        picked.height,
      );
      dirtyRef.current = true;
    } catch (error) {
      // Antes o erro era engolido e tocar em "Adicionar foto" nao fazia nada.
      // O detalhe fica fora da tela do usuario (sem caminho nem conteudo).
      if (__DEV__) console.warn('[dyarium] falha ao anexar foto', String(error));
      Alert.alert('Não foi possível anexar a foto', 'Tente de novo em instantes.');
    }
  }, [noteId]);

  // Toque na imagem: abre maior, para conferir. Fecha ao tocar em qualquer lugar.
  const handleImageOpen = useCallback((src: string) => {
    if (src) setViewerSrc(src);
  }, []);
  const closeViewer = useCallback(() => setViewerSrc(null), []);

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

  // Acao pedida pela tela inicial (texto/imagem/link): roda uma vez, quando a
  // nota ja esta na tela.
  useEffect(() => {
    if (actionDoneRef.current || !noteId) return undefined;
    actionDoneRef.current = true;
    const timer = setTimeout(() => {
      if (action === 'text') editorRef.current?.focus();
      else if (action === 'image') void handleAddImage();
      else if (action === 'link') void openLinkModal();
    }, 0);
    return () => clearTimeout(timer);
  }, [action, noteId, handleAddImage, openLinkModal]);

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

  // Derivados do documento: digitar no titulo re-renderiza a tela, e o corpo
  // inteiro nao precisa ser parseado de novo a cada letra.
  const bodyAudios = useMemo(() => noteAudioNodes(body), [body]);

  if (!note) {
    // A lista pode ainda estar carregando (abertura por link/atalho). Mostrar
    // "nota nao encontrada" antes disso piscava na tela e parecia perda de dado.
    if (!library.ready) {
      // O cabecalho responde na hora; o carregamento fica so na area do corpo.
      return (
        <Screen>
          <View style={styles.header}>
            <Pressable onPress={goBack} style={styles.iconButton} accessibilityLabel="Voltar">
              <Ionicons name="chevron-back" size={24} color={colors.text} />
            </Pressable>
            <View style={styles.headerActions} />
          </View>
          <View style={[styles.content, { paddingTop: spacing.lg }]}>
            <ActivityIndicator color={colors.textTertiary} testID="note-loading" />
          </View>
        </Screen>
      );
    }
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

  // Derivados do documento: digitar no titulo re-renderiza a tela, e o corpo
  // inteiro nao precisa ser parseado de novo a cada letra.
  const hasAudio = Boolean(note.filePath) || bodyAudios.length > 0 || stack.audios.length > 0;
  // Notas antigas ainda tem o audio fora do documento. Nelas o player do topo
  // continua sendo a unica forma de ouvir; quando o audio ja e um no do corpo,
  // o player fica no meio do texto e o topo nao duplica.
  const legacyAudio = Boolean(note.filePath) && bodyAudios.length === 0;
  // O primeiro audio da pilha e o proprio audio desta nota (o app que gravou e
  // subiu): o player local ja o mostra. Os demais vieram do dashboard e ganham
  // a sua linha. Sem audio local (nota criada no servidor), a pilha e inteira.
  const stackAudios =
    bodyAudios.length > 0 ? [] : legacyAudio ? stack.audios.slice(1) : stack.audios;
  const editorPlaceholder = hasAudio ? 'Escreva sobre este áudio...' : 'Comece a escrever...';
  // Em tela estreita o titulo comeca menor; em ambas quebra linha em vez de sumir.
  const titleSize = titleFontSize(title, windowWidth < 380 ? 30 : 34, 24);
  const noteDateText = formatDateTime(noteDateIso(note));
  const noteDateShown = noteDateLabel(title, note);
  const currentNotebook =
    library.notebooks.find(
      (notebook) => notebook.id === (note.notebookId ?? DEFAULT_NOTEBOOK_ID),
    ) ?? library.notebooks.find((notebook) => notebook.isDefault);
  const notebookName = currentNotebook?.name ?? 'Notas ao acaso';
  const properties: NoteProperty[] = [
    { label: 'Caderno', value: notebookName },
    { label: 'Gravada em', value: noteDateText },
    note.source === 'share'
      ? { label: 'Importada em', value: formatDateTime(note.createdAt) }
      : { label: 'Criada em', value: formatDateTime(note.createdAt) },
    ...(note.tags && note.tags.length > 0
      ? [{ label: 'Tags', value: note.tags.join(', ') }]
      : []),
    { label: 'Origem', value: hasAudio ? (note.source === 'share' ? 'Audio importado' : 'Audio') : 'Texto' },
    { label: 'Palavras', value: String(words) },
    { label: 'Caracteres', value: String(chars) },
    { label: 'Tamanho', value: formatBytes(totalBytes) },
    { label: 'Status', value: STATUS_META[note.status].label },
  ];

  const handleShare = async () => {
    const liveBody = bodyRef.current;
    const parts: string[] = [title.trim() || note.title];
    const plain = markdownToPlain(liveBody).trim();
    if (plain) parts.push('', plain);
    if (hasAudio && note.transcript && note.transcript.trim() && note.transcript !== liveBody) {
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
        <Pressable
          style={styles.headerNotebook}
          onPress={() => setNotebookPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Caderno ${notebookName}. Trocar de caderno`}
        >
          <View
            style={[
              styles.headerNotebookDot,
              { backgroundColor: currentNotebook?.color || colors.textTertiary },
            ]}
          />
          <Text style={styles.headerNotebookName} numberOfLines={1}>
            {notebookName}
          </Text>
          <Ionicons name="chevron-down" size={13} color={colors.textTertiary} />
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

      {/* A nota e uma peca so: titulo, data, tags, audios, transcricao e corpo
          rolam juntos nesta ScrollView. O cabecalho (voltar/caderno/menu)
          continua fixo. */}
      <ScrollView
        testID="note-scroll"
        style={styles.scroll}
        contentContainerStyle={styles.content}
        // "always": o toque no campo nativo do editor tem de chegar nele,
        // senao o teclado nao sobe e nao da para digitar.
        keyboardShouldPersistTaps="always"
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.titleBlock}>
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
              { fontFamily: fontFamilyNative(typography.family) },
              { fontSize: titleSize, lineHeight: Math.round(titleSize * 1.25) },
            ]}
          />
          {noteDateShown ? <Text style={styles.noteDate}>{noteDateShown}</Text> : null}
          <NoteMetaRow
            note={note}
            onAddTag={() => setTagPickerOpen(true)}
            onRemoveTag={(tag) =>
              void library.setNoteTags(
                note.id,
                (note.tags ?? []).filter((item) => item.toLowerCase() !== tag.toLowerCase()),
              )
            }
          />
        </View>

        <View>
          {/* Player, pilha de audios e transcricao ficam sempre visiveis. O
              teclado so encolhe a area do editor; nada acima da nota e
              ocultado nem deslocado. */}
          {legacyAudio ? (
            <NoteAudioPlayer player={player} durationMs={note.durationMs} />
          ) : null}

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

          {legacyAudio && segments && segments.length > 0 ? (
            <SyncedTranscript
              player={player}
              segments={segments}
              onOpen={openTranscript}
              onSeek={seekTranscript}
            />
          ) : legacyAudio && note.transcript && note.transcript.trim() ? (
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
          ) : legacyAudio && !note.hasTranscript && note.transcriptStatus === 'pending' ? (
            <View style={styles.transcribing}>
              <ActivityIndicator size="small" color={colors.textSecondary} />
              <Text style={styles.meta}>
                Transcrevendo{transcriptionPercent > 0 ? ` ${Math.round(transcriptionPercent)}%` : '...'}
              </Text>
            </View>
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

          <NoteBody
            key={editorKey}
            ref={editorRef}
            value={body}
            onChangeMarkdown={handleBodyChange}
            onImageOpen={handleImageOpen}
            placeholder={editorPlaceholder}
            imageSources={imageSources}
            audioSource={resolveAudio}
            audioTranscripts={audioTranscripts}
            transcribingPercent={
              transcriptionPercent > 0 && transcriptionPercent < 100
                ? transcriptionPercent
                : undefined
            }
            typography={typography}
          />
        </View>
      </ScrollView>

      <View style={[styles.toolbarHost, { paddingBottom: keyboardPad }]}>
        <View style={styles.toolbar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="always"
            contentContainerStyle={styles.toolRow}
          >
            <ToolButton label="Negrito" onPress={() => editorRef.current?.format('bold')}>
              <Text style={styles.toolBold}>B</Text>
            </ToolButton>
            <ToolButton label="Itálico" onPress={() => editorRef.current?.format('italic')}>
              <Text style={styles.toolItalic}>I</Text>
            </ToolButton>
            <ToolButton label="Tachado" onPress={() => editorRef.current?.format('strike')}>
              <Text style={styles.toolStrike}>S</Text>
            </ToolButton>
            <ToolButton label="Código" onPress={() => editorRef.current?.format('code')}>
              <Ionicons name="code-slash-outline" size={18} color={colors.text} />
            </ToolButton>
            <View style={styles.toolDivider} />
            <ToolButton label="Título" onPress={() => editorRef.current?.format('heading')}>
              <Text style={styles.toolBold}>H</Text>
            </ToolButton>
            <ToolButton label="Lista" onPress={() => editorRef.current?.format('list')}>
              <Ionicons name="list-outline" size={18} color={colors.text} />
            </ToolButton>
            <ToolButton
              label="Lista numerada"
              onPress={() => editorRef.current?.format('ordered')}
            >
              <Text style={styles.toolNumber}>1.</Text>
            </ToolButton>
            <ToolButton label="Citação" onPress={() => editorRef.current?.format('quote')}>
              <Ionicons name="chatbox-ellipses-outline" size={18} color={colors.text} />
            </ToolButton>
            <View style={styles.toolDivider} />
            <ToolButton label="Link" onPress={() => void openLinkModal()}>
              <Ionicons name="link-outline" size={18} color={colors.text} />
            </ToolButton>
            <ToolButton label="Adicionar foto" onPress={() => void handleAddImage()}>
              <Ionicons name="image-outline" size={18} color={colors.text} />
            </ToolButton>
          </ScrollView>
        </View>
      </View>

      {conflictOpen ? (
        <ConflictDialog
          note={note}
          visible
          onKeepMine={handleKeepMine}
          onTakeTheirs={handleTakeTheirs}
          onDismiss={() => setConflictSnoozed(conflictKey)}
        />
      ) : null}

      {notebookPickerOpen ? (
        <NotebookPicker
          visible
          notebooks={library.notebooks}
          currentId={note.notebookId ?? DEFAULT_NOTEBOOK_ID}
          onClose={() => setNotebookPickerOpen(false)}
          onSelect={(notebookId) => {
            setNotebookPickerOpen(false);
            void library.moveNoteToNotebook(note.id, notebookId);
          }}
        />
      ) : null}

      {tagPickerOpen ? (
        <TagPicker
          visible
          selected={noteTags}
          knownTags={knownTags}
          onClose={() => setTagPickerOpen(false)}
          onSave={(tags) => {
            setTagPickerOpen(false);
            void library.setNoteTags(note.id, tags);
          }}
        />
      ) : null}

      {menuOpen ? (
        <NoteMenu
          visible
          title={title}
        properties={properties}
        analysis={
          localAnalysisEnabled()
            ? analysisView
            : note.entryId
              ? (analysisView ?? (analysisChecked ? null : undefined))
              : undefined
        }
        anchor={menuAnchor}
        analysisEnabled={localAnalysisEnabled()}
        analysisReady={localAnalysisReady}
        analysisBusy={analysisBusy}
        analysisInput={analysisInput}
        analysisStale={analysisStale}
        analysisSimplified={analysisSimplified}
        analysisLowPower={analysisLowPower}
        onChangeAnalysisLowPower={(next) => void setAnalysisLowPower(next)}
        analysisModelLabel={analysisModelById(analysisModel)?.label ?? analysisModel}
        analysisLive={analysisLive}
        analysisLast={analysisLast}
        analysisError={analysisError}
        onAnalyzeLocal={() => void handleAnalyzeLocal()}
        onStopAnalysis={handleStopAnalysis}
        typography={typography}
        onChangeTypography={(next) => void setTypography(next)}
        onClose={() => setMenuOpen(false)}
          onShare={() => {
            setMenuOpen(false);
            void handleShare();
          }}
        />
      ) : null}

      {linkOpen ? (
        <FastModal visible onRequestClose={() => setLinkOpen(false)}>
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
      ) : null}

      {viewerSrc != null ? (
        <FastModal visible onRequestClose={closeViewer}>
          <Pressable style={styles.viewerBackdrop} onPress={closeViewer} accessibilityLabel="Fechar">
            <Image
              source={{ uri: viewerSrc }}
              style={styles.viewerImage}
              resizeMode="contain"
            />
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
      ) : null}
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
  headerNotebook: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: spacing.xs,
  },
  headerNotebookDot: { width: 7, height: 7, borderRadius: 4 },
  headerNotebookName: {
    flexShrink: 1,
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
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
  // A nota inteira rola nesta ScrollView; o cabecalho fica fixo.
  scroll: { flex: 1, backgroundColor: colors.bg },
  content: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxxl,
    gap: spacing.sm,
  },
  toolbarHost: { backgroundColor: colors.surface },
  titleBlock: { gap: spacing.xs },
  titleInput: {
    color: colors.text,
    fontWeight: '700',
    paddingVertical: spacing.sm,
    textAlignVertical: 'top',
    backgroundColor: 'transparent',
  },
  noteDate: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    paddingBottom: spacing.xs,
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
    height: 44,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  toolRow: { alignItems: 'center', paddingHorizontal: spacing.xs, gap: 2 },
  tool: { width: 34, height: 44, alignItems: 'center', justifyContent: 'center' },
  toolDivider: {
    width: StyleSheet.hairlineWidth,
    height: 20,
    backgroundColor: colors.border,
    marginHorizontal: spacing.xs,
  },
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
  toolStrike: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '600',
    textDecorationLine: 'line-through',
  },
  toolNumber: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
});
