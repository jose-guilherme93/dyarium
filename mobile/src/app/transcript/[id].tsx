import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayerStatus } from 'expo-audio';
import { useLocalSearchParams } from 'expo-router';
import { back } from '@/services/appNavigation';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  FlatList,
  Switch,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
} from 'react-native';
import { Text, TextInput } from '@/components/AppText';
import { AudioWaveform } from '@/components/AudioWaveform';
import { FastModal } from '@/components/FastModal';
import { Press } from '@/components/Press';

import { DyariumApi, type FetchLike, type TranscriptSegment } from '@/core/api';
import { formatDuration } from '@/core/format';
import { audioRefFromPath } from '@/core/noteAudio';
import { reviewFromServer, visibleTranscript } from '@/core/transcriptReview';
import {
  CAPTURE_NOTEBOOK,
  CAPTURE_OPTIONS,
  buildCapture,
  type CaptureKind,
} from '@/core/transcriptCapture';
import { activeSegmentIndex } from '@/core/transcript';
import { useRenderCount } from '@/dev/perf';
import { resolveAudioSource } from '@/services/attachments';
import { releaseAudioFocus } from '@/services/audioFocus';
import { getRecording, upsertRecording } from '@/services/db';
import { loadServerConfig } from '@/services/secure';
import { pushTranscript } from '@/services/transcriptSync';
import { emitRecording } from '@/services/uploaderLoop';
import { useLibrary } from '@/state/LibraryContext';
import { usePlayAt, usePlayback } from '@/state/PlaybackContext';
import { useSettings } from '@/state/SettingsContext';
import { useTranscriptionProgress } from '@/state/useTranscriptionProgress';
import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

const doFetch = globalThis.fetch as unknown as FetchLike;

/**
 * Minutagem do trecho que esta tocando: pulsa devagar, como uma luz que quase
 * acende e enfraquece a cada segundo. Parada, fica na cor normal.
 */
function PulsingTimestamp({ active, children }: { active: boolean; children: ReactNode }) {
  const styles = useThemedStyles(baseStyles);
  const [pulse] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (!active) {
      pulse.stopAnimation();
      pulse.setValue(1);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.35,
          duration: 500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, pulse]);

  return (
    <Animated.Text
      style={[styles.timestampText, active && styles.timestampActive, active && { opacity: pulse }]}
    >
      {children}
    </Animated.Text>
  );
}

interface SegmentRowProps {
  segment: TranscriptSegment;
  index: number;
  active: boolean;
  /** Abre as aspas no primeiro trecho e fecha no ultimo: o texto e um so. */
  quoteStart: boolean;
  quoteEnd: boolean;
  /** Mostra o texto antigo do whisper (um unico interruptor no topo). */
  showOriginal: boolean;
  onSeek(index: number): void;
  /** Toque no trecho: abre o popup de edicao. */
  onEdit(index: number): void;
  /** Pressionar: menu de acoes ao lado do dedo. */
  onActions(index: number, point: { x: number; y: number }): void;
}

/**
 * Uma linha da transcricao: minutagem na margem e o trecho ao lado, como
 * sempre foi. O texto nao e quebrado em palavras: ele flui e quebra so pela
 * largura, para nao separar artigo de substantivo.
 */
const SegmentRow = memo(function SegmentRow({
  segment,
  index,
  active,
  quoteStart,
  quoteEnd,
  showOriginal,
  onSeek,
  onEdit,
  onActions,
}: SegmentRowProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();
  // O que o trecho virou fica em destaque no fim da linha, no lugar onde antes
  // morava o icone de IA do trecho: cor por tipo, para reconhecer de longe.
  const captureTone =
    segment.capture === 'task'
      ? { strong: colors.success, soft: colors.successSoft }
      : segment.capture === 'idea'
        ? { strong: colors.warning, soft: colors.warningSoft }
        : { strong: colors.info, soft: colors.infoSoft };

  // O leitor mostra a revisao; o original do whisper fica no interruptor do topo.
  const visible = (segment.revised ?? segment.text).replace(/\s+/g, ' ').trim();
  return (
    <View style={styles.segment}>
      <Press
        style={styles.timestamp}
        onPress={() => onSeek(index)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Ouvir a partir de ${formatDuration(segment.start_ms)}`}
      >
        <PulsingTimestamp active={active}>{formatDuration(segment.start_ms)}</PulsingTimestamp>
      </Press>
      <Press
        style={styles.segmentBody}
        onPress={() => onEdit(index)}
        onLongPress={(event: GestureResponderEvent) => {
          const { pageX, pageY } = event.nativeEvent;
          onActions(index, { x: pageX, y: pageY });
        }}
        accessibilityRole="button"
        accessibilityLabel={`Trecho de ${formatDuration(segment.start_ms)}. Toque para editar, segure para ações.`}
      >
        <Text style={styles.segmentText}>
          {quoteStart ? '“' : ''}
          {visible}
          {quoteEnd ? '”' : ''}
        </Text>
        {showOriginal && segment.revised ? (
          <Text style={styles.segmentOriginal}>Original do whisper: {segment.text}</Text>
        ) : null}
      </Press>
      {segment.capture ? (
        <View
          style={[styles.captureBadge, { backgroundColor: captureTone.soft }]}
          accessibilityRole="image"
          accessibilityLabel={
            segment.capture === 'task'
              ? 'Tarefa'
              : segment.capture === 'idea'
                ? 'Ideia'
                : 'Citação'
          }
        >
          <Ionicons
            name={
              segment.capture === 'task'
                ? 'checkbox-outline'
                : segment.capture === 'idea'
                  ? 'bulb-outline'
                  : 'chatbox-ellipses-outline'
            }
            size={14}
            color={captureTone.strong}
          />
        </View>
      ) : null}
    </View>
  );
});

/**
 * Transcricao completa do audio, em segmentos com minutagem. O trecho ativo
 * acompanha o play; a minutagem toca dali e o texto abre a edicao.
 */
export default function TranscriptScreen() {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  const { id, edit, at } = useLocalSearchParams<{ id: string; edit?: string; at?: string }>();
  const {
    recordings,
    notebooks,
    createNotebook,
    createTextNote,
    setNoteTags,
    updateNote,
    moveNoteToNotebook,
    kick,
  } = useLibrary();
  const { reviewTranscript: reviewEnabled, literalTranscript, setLiteralTranscript } =
    useSettings();
  const note = recordings.find((r) => r.id === id);
  const noteId = note?.id;
  const entryId = note?.entryId;
  const cachedSegments = note?.transcriptSegments;
  const hasCache = Boolean(cachedSegments && cachedSegments.length > 0);
  // Nota cuja transcricao veio do servidor: abrir a tela confere se uma
  // revisao nova chegou la. Com edicao local pendente, o cache manda.
  const hasLocalEdit = Boolean(cachedSegments?.some((segment) => segment.edited));

  const [fetched, setFetched] = useState<TranscriptSegment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  // Menu de captura aberto: guarda o trecho e onde o dedo estava.
  // Um unico interruptor: mostra o texto antigo do whisper em todos os trechos
  // revisados. Fica no topo, discreto, ao lado da duracao total.
  const [showOriginal, setShowOriginal] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [capture, setCapture] = useState<{
    segment: TranscriptSegment;
    index: number;
    point: { x: number; y: number };
  } | null>(null);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const draftRef = useRef('');
  const listRef = useRef<FlatList<TranscriptSegment>>(null);
  const activeIndexRef = useRef(-1);
  /** O trecho pedido pela previa (`edit`) ja foi aberto uma vez. */
  const editOpenedRef = useRef(false);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // Editar um trecho (palavra/frase): grava local e envia ao servidor.
  const saveEdit = useCallback(
    async (index: number, value: string) => {
      if (!noteId) return;
      const current = await getRecording(noteId);
      if (!current) return;
      const list = [...(current.transcriptSegments ?? [])];
      if (!list[index]) return;
      // Escrita do usuario vence: o trecho sai da revisao e fica marcado para
      // o servidor nunca revisar por cima.
      list[index] = {
        ...list[index],
        text: value.trim(),
        revised: undefined,
        edited: true,
      };
      const updated = {
        ...current,
        transcriptSegments: list,
        transcript: visibleTranscript(list),
        updatedAt: new Date().toISOString(),
      };
      await upsertRecording(updated);
      emitRecording(updated);
      setEditingIndex(null);
      void pushTranscript(noteId);
    },
    [noteId],
  );

  const segments = hasCache && cachedSegments ? cachedSegments : fetched;

  const transcriptionPercent = useTranscriptionProgress(noteId);
  const transcribing = note?.transcriptStatus === 'pending';
  // A passada esta rodando agora? A atividade e por gravacao; sem isso o chip
  // tratava uma passada interrompida como se estivesse trabalhando.

  // Toque longo numa linha da previa abre a transcricao ja editando aquele
  // trecho. O parametro chega em ms; casa pelo inicio do segmento, porque o
  // indice local pode mudar se a transcricao for recarregada.
  const editStartMs = edit ? Number(edit) : null;
  useEffect(() => {
    if (editOpenedRef.current) return;
    if (editStartMs === null || !Number.isFinite(editStartMs) || segments.length === 0) return;
    editOpenedRef.current = true;
    const index = segments.findIndex(
      (segment) => Math.abs(segment.start_ms - editStartMs) < 1,
    );
    if (index < 0) return;
    // Estado derivado de dados assincronos: os segmentos chegam depois do
    // parametro de rota, entao abrir a edicao aqui e a sincronizacao com o
    // carregamento da transcricao.
    // O trecho pedido pela rota abre em edicao quando os segmentos chegam.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditingIndex(index);
    setDraft(segments[index].text);
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.4 });
    });
  }, [editStartMs, segments]);

  // Mesmo player unico da nota: ao abrir a transcricao o audio continua
  // exatamente de onde estava (sem criar outro player e sem reiniciar).
  const player = usePlayback();
  const playAt = usePlayAt();
  const status = useAudioPlayerStatus(player);
  const currentMs = (status.currentTime || 0) * 1000;
  useRenderCount('Transcript');

  // Referencia do audio da nota: o mesmo arquivo (local ou anexo) que a nota
  // toca. Resolver aqui evita apontar o player para uma fonte diferente e
  // recomecar o audio do zero ao abrir esta tela.
  const audioRef = useMemo(() => {
    if (!note) return undefined;
    return (
      audioRefFromPath(note.filePath) ??
      (note.serverAttachmentId ? `attachment:${note.serverAttachmentId}` : undefined) ??
      (note.serverAudios?.[0]?.id ? `attachment:${note.serverAudios[0].id}` : undefined)
    );
  }, [note]);
  const uriRef = useRef<string | null>(null);
  const resolveUri = useCallback(async () => {
    if (uriRef.current) return uriRef.current;
    if (!note || !audioRef) return null;
    const uri = await resolveAudioSource(note.id, audioRef, note.attachments ?? {});
    if (uri) uriRef.current = uri;
    return uri;
  }, [audioRef, note]);

  // A midia da nota pode ganhar um anexo novo (upload): descarta o uri antigo.
  useEffect(() => {
    uriRef.current = null;
  }, [audioRef]);

  // Veio de uma nota capturada ("ouvir o trecho"): abre no ponto exato e
  // comeca dali. Roda uma vez, quando os segmentos chegam.
  const atMs = at ? Number(at) : null;
  const atOpenedRef = useRef(false);
  useEffect(() => {
    if (atOpenedRef.current) return;
    if (atMs === null || !Number.isFinite(atMs) || segments.length === 0) return;
    atOpenedRef.current = true;
    let index = 0;
    for (let i = 0; i < segments.length; i += 1) {
      if (segments[i].start_ms <= atMs) index = i;
      else break;
    }
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.45 });
    });
    void resolveUri().then((uri) => {
      if (uri) playAt(uri, atMs / 1000);
    });
  }, [atMs, segments, resolveUri, playAt]);


  useEffect(() => {
    // Cache local de uma nota nossa: nao refaz o fetch ao abrir. Nota do
    // servidor e conferida mesmo com cache, para a revisao feita la aparecer
    // aqui; uma edicao local pendente vence e evita sobrescrever.
    const serverOwned = note?.transcriptOrigin === 'server' && !hasLocalEdit;
    if (!entryId || (hasCache && !serverOwned)) return undefined;
    let alive = true;
    (async () => {
      const config = await loadServerConfig();
      if (!config) return;
      try {
        const api = new DyariumApi(config, doFetch);
        const transcript = await api.getTranscript(entryId);
        if (!alive) return;
        // O servidor nao conhece as capturas locais: casa pelo inicio do trecho
        // para o icone nao sumir quando a transcricao e relida.
        const prior = noteId ? (await getRecording(noteId))?.transcriptSegments ?? [] : [];
        const merged = (transcript.segments ?? []).map((segment) => {
          const local = prior.find((item) => item.start_ms === segment.start_ms);
          return local?.capture ? { ...segment, capture: local.capture } : segment;
        });
        setFetched(merged);
        // Persiste o cache local para as proximas aberturas.
        if (transcript.segments && transcript.segments.length > 0 && noteId) {
          const current = await getRecording(noteId);
          if (current) {
            await upsertRecording({
              ...current,
              transcriptSegments: merged,
              transcriptOrigin: current.transcriptOrigin === 'local' ? 'local' : 'server',
              transcriptReview:
                reviewFromServer(transcript, transcript.segments) ?? current.transcriptReview,
              updatedAt: new Date().toISOString(),
            });
          }
        }
      } catch {
        if (alive) setError('Não foi possível carregar a transcrição agora.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [entryId, hasCache, noteId, note?.transcriptOrigin, hasLocalEdit]);

  const activeIndex = useMemo(
    () => activeSegmentIndex(segments, currentMs),
    [segments, currentMs],
  );

  useEffect(() => {
    if (activeIndex === activeIndexRef.current) return;
    activeIndexRef.current = activeIndex;
    if (activeIndex >= 0) {
      listRef.current?.scrollToIndex({ index: activeIndex, viewPosition: 0.3, animated: true });
    }
  }, [activeIndex]);

  const toggle = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    const at = status.currentTime || 0;
    void resolveUri().then((uri) => {
      if (uri) playAt(uri, at);
    });
  };

  useEffect(() => () => releaseAudioFocus(player), [player]);

  // Callbacks estaveis: as linhas memoizadas so re-renderizam quando o proprio
  // trecho muda (ativo/edicao), nao a cada atualizacao de tempo do player.
  const handleSeek = useCallback(
    (index: number) => {
      const seg = segments[index];
      if (!seg) return;
      void resolveUri().then((uri) => {
        if (uri) playAt(uri, seg.start_ms / 1000);
      });
    },
    [playAt, resolveUri, segments],
  );
  const handleStartEdit = useCallback(
    (index: number) => {
      const seg = segments[index];
      if (seg) setDraft(seg.text);
      setEditingIndex(index);
    },
    [segments],
  );
  const handleOpenActions = useCallback(
    (index: number, point: { x: number; y: number }) => {
      const seg = segments[index];
      if (!seg) return;
      setEditingIndex(null);
      setCapture({ segment: seg, index, point });
    },
    [segments],
  );
  /**
   * Cada tipo vira uma nota no caderno "Tarefas e ideias", com a tag do tipo.
   * O caderno nasce no primeiro uso e o sync leva os dois.
   */
  /** Grava no trecho que ele virou tarefa/ideia/citacao: o icone mora nele. */
  const markCaptured = useCallback(
    async (index: number, kind: CaptureKind) => {
      if (!noteId) return;
      const current = await getRecording(noteId);
      if (!current) return;
      const list = [...(current.transcriptSegments ?? [])];
      if (!list[index]) return;
      list[index] = { ...list[index], capture: kind };
      const updated = {
        ...current,
        transcriptSegments: list,
        updatedAt: new Date().toISOString(),
      };
      await upsertRecording(updated);
      emitRecording(updated);
    },
    [noteId],
  );

  const handleCapture = useCallback(
    async (kind: CaptureKind) => {
      const target = capture;
      if (!target) return;
      setCaptureError(null);
      setCapture(null);
      try {
        const draftNote = buildCapture(kind, target.segment, {
          noteTitle: note?.title ?? '',
          stamp: formatDuration(target.segment.start_ms),
        });
        // Uma nota por nota de origem: tudo o que sai dela se acumula no mesmo
        // lugar, em vez de abrir uma nota nova a cada tarefa ou ideia. Sem a nota
        // de origem, nao ha como achar a nota acumulada (um `undefined` casaria
        // com qualquer registro sem referencia).
        const sourceId = note?.id;
        const existingNote = sourceId
          ? recordings.find((item) => item.captureSourceId === sourceId)
          : undefined;
        const existingNotebook = notebooks.find(
          (notebook) =>
            (notebook.name ?? '').trim().toLowerCase() === CAPTURE_NOTEBOOK.toLowerCase(),
        );
        const notebook = existingNotebook ?? (await createNotebook({ name: CAPTURE_NOTEBOOK }));
        // Nota acumulada que ficou em outro caderno (versao anterior, sync que
        // moveu) volta para o caderno de capturas em vez de sumir da vista.
        if (existingNote && existingNote.notebookId !== notebook.id) {
          await moveNoteToNotebook(existingNote.id, notebook.id);
        }
        if (existingNote) {
          const alreadyThere = (existingNote.text ?? '').includes(draftNote.text);
          if (!alreadyThere) {
            const merged = [existingNote.text?.trim(), draftNote.text]
              .filter(Boolean)
              .join('\n\n');
            await updateNote(existingNote.id, { text: merged });
          }
          const tags = [...(existingNote.tags ?? [])];
          if (!tags.some((tag) => tag.toLowerCase() === draftNote.tag.toLowerCase())) {
            tags.push(draftNote.tag);
          }
          await setNoteTags(existingNote.id, tags);
          kick();
        } else {
          const created = await createTextNote({
            title: draftNote.title,
            text: draftNote.text,
            notebookId: notebook.id,
            // Referencia local: o botao na nota volta para este trecho exato.
            capture: note
              ? { sourceId: note.id, startMs: target.segment.start_ms }
              : undefined,
          });
          await setNoteTags(created.id, [draftNote.tag]);
          if (__DEV__) {
            console.log('[capture] criada', {
              id: created.id,
              notebook: notebook.id,
              notebookName: notebook.name,
            });
          }
        }
        await markCaptured(target.index, kind);
        if (__DEV__) {
          console.log('[capture] ok', {
            kind,
            source: sourceId ?? null,
            existing: existingNote?.id ?? null,
          });
        }
      } catch (error) {
        // Falha silenciosa aqui deixava a impressao de que nada aconteceu.
        console.warn('[capture] falhou', error instanceof Error ? error.message : String(error));
        setCaptureError('Não foi possível guardar esta captura.');
      }
    },
    [
      capture,
      note,
      notebooks,
      recordings,
      createNotebook,
      createTextNote,
      setNoteTags,
      updateNote,
      kick,
      moveNoteToNotebook,
      markCaptured,
    ],
  );
  const handleSubmitEdit = useCallback(
    (index: number) => void saveEdit(index, draftRef.current),
    [saveEdit],
  );
  const handleCancelEdit = useCallback(() => setEditingIndex(null), []);

  const renderItem = useCallback(
    ({ item, index }: { item: TranscriptSegment; index: number }) => (
      <SegmentRow
        segment={item}
        index={index}
        active={index === activeIndex}
        quoteStart={index === 0}
        quoteEnd={index === segments.length - 1}
        showOriginal={showOriginal}
        onSeek={handleSeek}
        onEdit={handleStartEdit}
        onActions={handleOpenActions}
      />
    ),
    [activeIndex, segments.length, showOriginal, handleSeek, handleStartEdit, handleOpenActions],
  );

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Press onPress={() => back()} accessibilityLabel="Voltar" hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Press>
        <Text style={styles.title}>Transcrição</Text>
        <View style={styles.spacer} />
      </View>

      {captureError ? <Text style={styles.captureError}>{captureError}</Text> : null}

      {audioRef ? (
        <View style={styles.player}>
          <View style={styles.playerRow}>
            <Press
              style={styles.play}
              onPress={toggle}
              accessibilityLabel={status.playing ? 'Pausar' : 'Tocar'}
            >
              <Ionicons name={status.playing ? 'pause' : 'play'} size={20} color={colors.text} />
            </Press>
            <Text style={styles.playerTime}>
              {formatDuration(currentMs)} / {formatDuration((status.duration || 0) * 1000)}
            </Text>
            <View style={styles.playerSpacer} />
            {transcribing ? (
              <Text style={styles.progress}>
                Transcrevendo{transcriptionPercent > 0 ? ` ${Math.round(transcriptionPercent)}%` : '...'}
              </Text>
            ) : null}
            <Press
              onPress={() => setShowOriginal((value) => !value)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityState={{ selected: showOriginal }}
              accessibilityLabel="Ver o texto antigo do whisper"
            >
              <Ionicons
                name="sparkles-outline"
                size={16}
                color={showOriginal ? colors.textSecondary : colors.textTertiary}
              />
            </Press>
          </View>
          <AudioWaveform
            seed={note?.id ?? audioRef}
            current={status.currentTime || 0}
            duration={status.duration || (note?.durationMs ? note.durationMs / 1000 : 0)}
            segments={segments}
            onSeek={(seconds) => {
              void resolveUri().then((uri) => {
                if (uri) playAt(uri, seconds);
              });
            }}
          />
        </View>
      ) : null}

      {reviewEnabled && segments.length > 0 ? (
        <View style={styles.literalRow}>
          <View style={styles.literalText}>
            <Text style={styles.literalTitle}>Transcrição literal</Text>
            <Text style={styles.literalHint}>Mantém hesitações e gagueira.</Text>
          </View>
          <Switch
            value={literalTranscript}
            onValueChange={(value) => void setLiteralTranscript(value)}
            trackColor={{ true: colors.accent }}
            accessibilityLabel="Transcrição literal"
          />
        </View>
      ) : null}

      {segments.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            {error ??
              (note?.transcriptStatus === 'ready'
                ? 'Sem segmentos.'
                : `Transcrevendo${transcriptionPercent > 0 ? ` ${Math.round(transcriptionPercent)}%` : '...'}`)}
          </Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={segments}
          renderItem={renderItem}
          keyExtractor={(item, index) => `${item.start_ms}-${index}`}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
          onScrollToIndexFailed={(info) => {
            listRef.current?.scrollToOffset({
              offset: info.averageItemLength * info.index,
              animated: true,
            });
          }}
        />
      )}

      {/* Edicao do trecho: o toque na linha abre este popup, sem icone na
          lateral nem campo no meio do texto. */}
      <FastModal visible={editingIndex !== null} onRequestClose={handleCancelEdit}>
        <View style={styles.editBackdrop}>
          <Press style={styles.editCard} onPress={() => undefined} feedback={false}>
            <Text style={styles.editTitle}>Editar trecho</Text>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              multiline
              autoFocus
              selectionColor={colors.accent}
              style={styles.editInput}
            />
            <View style={styles.editActions}>
              <Press onPress={handleCancelEdit} accessibilityLabel="Cancelar">
                <Text style={styles.editCancel}>Cancelar</Text>
              </Press>
              <Press
                onPress={() => {
                  if (editingIndex !== null) handleSubmitEdit(editingIndex);
                }}
                accessibilityLabel="Salvar trecho"
              >
                <Text style={styles.editSave}>Salvar</Text>
              </Press>
            </View>
          </Press>
        </View>
      </FastModal>

      {/* Menu ao lado do dedo: transformar o trecho em tarefa, ideia ou citacao. */}
      <FastModal visible={capture !== null} onRequestClose={() => setCapture(null)}>
        <Press style={styles.menuBackdrop} onPress={() => setCapture(null)} feedback={false}>
          {capture ? (
            <Press
              style={[
                styles.menuCard,
                {
                  left: Math.max(12, Math.min(capture.point.x, windowWidth - 196)),
                  top: Math.max(60, Math.min(capture.point.y, windowHeight - 220)),
                },
              ]}
              onPress={() => undefined}
              feedback={false}
            >
              {CAPTURE_OPTIONS.map((option) => (
                <Press
                  key={option.kind}
                  style={styles.menuItem}
                  onPress={() => void handleCapture(option.kind)}
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                >
                  <Ionicons name={option.icon} size={18} color={colors.text} />
                  <Text style={styles.menuLabel}>{option.label}</Text>
                </Press>
              ))}
            </Press>
          ) : null}
        </Press>
      </FastModal>
    </View>
  );
}

const baseStyles = defineStyles({
  screen: { flex: 1, backgroundColor: baseColors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.md,
  },
  title: { color: baseColors.text, fontSize: fontSize.lg, fontWeight: '700' },
  captureError: {
    color: baseColors.danger,
    fontSize: fontSize.sm,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
  },
  spacer: { width: 24 },
  player: {
    gap: spacing.xs,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  play: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: baseColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerTime: { color: baseColors.textSecondary, fontSize: fontSize.sm, fontVariant: ['tabular-nums'] },
  playerSpacer: { flex: 1 },
  progress: { color: baseColors.accent, fontSize: fontSize.sm, fontWeight: '600' },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxxl },
  segment: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    paddingVertical: 3,
  },
  captureBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  // Minutagem discreta: existe para localizar o audio, nao para competir com
  // o texto. Por isso a coluna estreita e a fonte menor.
  timestamp: { width: 32, paddingTop: 4 },
  timestampText: {
    color: baseColors.textTertiary,
    fontSize: 10,
    fontVariant: ['tabular-nums'],
  },
  // So a minutagem acende: um halo azul marca onde o audio esta agora, sem
  // pintar a linha inteira (o texto continua legivel como texto).
  timestampActive: {
    color: baseColors.accent,
    textShadowColor: baseColors.accent,
    textShadowRadius: 7,
  },
  segmentBody: { flex: 1 },
  segmentText: {
    color: baseColors.textSecondary,
    fontSize: fontSize.md,
    // Linhas mais juntas; o respiro entre trechos fica no padding da linha.
    lineHeight: 20,
    fontStyle: 'italic',
  },
  segmentTextActive: { color: baseColors.text },
  segmentOriginal: {
    color: baseColors.textTertiary,
    fontSize: fontSize.sm,
    lineHeight: 19,
    marginTop: 2,
  },
  literalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: baseColors.surface,
  },
  literalText: { flex: 1, gap: 2 },
  literalTitle: { color: baseColors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  literalHint: { color: baseColors.textTertiary, fontSize: fontSize.xs, lineHeight: 16 },
  editBackdrop: {
    flex: 1,
    backgroundColor: baseColors.overlay,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  editCard: {
    backgroundColor: baseColors.bgElevated,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  editTitle: { color: baseColors.text, fontSize: fontSize.md, fontWeight: '700' },
  editWrap: { flex: 1, gap: spacing.sm },
  editInput: {
    color: baseColors.text,
    fontSize: fontSize.md,
    lineHeight: 22,
    backgroundColor: baseColors.bgElevated,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.lg },
  editCancel: { color: baseColors.textSecondary, fontSize: fontSize.sm },
  editSave: { color: baseColors.accent, fontSize: fontSize.sm, fontWeight: '700' },
  menuBackdrop: { flex: 1 },
  menuCard: {
    position: 'absolute',
    width: 184,
    backgroundColor: baseColors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: baseColors.border,
    paddingVertical: spacing.xs,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  menuLabel: { color: baseColors.text, fontSize: fontSize.sm, fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyText: { color: baseColors.textSecondary, fontSize: fontSize.sm, textAlign: 'center' },
});
