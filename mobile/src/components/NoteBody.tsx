/**
 * Corpo da nota: uma lista ordenada de nos.
 *
 * Texto e editado em um `EnrichedTextInput` por no; imagem e audio sao
 * componentes nativos entre os textos. A insercao no cursor divide o no de
 * texto na posicao exata, entao foto e audio entram no meio da nota, nao no fim.
 * A foto e um no com largura em percentual da nota: ela pode ser redimensionada
 * e removida pelo proprio bloco.
 *
 * O markdown continua sendo o formato salvo. Cada no de texto vira HTML para o
 * editor e volta para markdown no debounce, no blur e no flush; os nos de imagem
 * e audio carregam a referencia canonica (`local:`/`attachment:`) e nunca um
 * caminho do aparelho.
 *
 * Todo trecho de texto e o editor rico, sempre montado: nao existe estado de
 * leitura nem renderizador de previa. O texto aparece formatado em todos os
 * estados, e o cursor e do proprio Android (o toque chega no campo, sem passar
 * por uma camada que calcule a posicao).
 */

import { Ionicons } from '@expo/vector-icons';
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  Image,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Press } from '@/components/Press';
import {
  EnrichedTextInput,
  type EnrichedInputStyle,
  type EnrichedTextInputInstance,
  type HtmlStyle,
  type OnChangeSelectionEvent,
} from 'react-native-enriched-html';

import { DEFAULT_IMAGE_WIDTH, IMAGE_WIDTH_OPTIONS, clampImageWidth } from '@/core/image';
import {
  insertIntoNoteNodes,
  parseNoteDocument,
  removeFromNoteNodes,
  serializeNoteDocument,
  setWidthInNoteNodes,
  type NoteAudioNode,
  type NoteImageNode,
  type NoteNode,
  type NoteTextNode,
} from '@/core/noteDocument';
import { htmlToMarkdown, markdownToHtml, noteImages } from '@/core/noteHtml';
import { fontFamilyNative, fontWeightNative, noteLineHeight, NOTE_LETTER_SPACING } from '@/core/typography';
import type { TranscriptSegment } from '@/core/types';
import { mark } from '@/dev/perf';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { cachedImageRatio, imageRatio, measureImageRatio, rememberImageRatio } from '@/services/imageRatios';
import { baseColors, radius, spacing } from '@/theme/tokens';

import { FastModal } from './FastModal';
import { NoteAudioCard } from './NoteAudioCard';
import { noteHtmlStyle } from './noteHtmlStyle';
import type { FormatType, NoteBodyHandle, NoteBodyProps } from './noteBodyTypes';
import { defineStyles } from '@/theme/themedStyles';

export type { FormatType, NoteBodyHandle, NoteBodyProps } from './noteBodyTypes';

// Extrair o HTML do editor nativo e caro. Durante a digitacao o texto fica no
// campo; o markdown so e montado depois de uma pausa longa, no blur ou ao sair.
const FLUSH_MS = 4000;
const MIN_TEXT_HEIGHT = 28;
const EMPTY_SOURCES: Record<string, string> = {};
const EMPTY_SEGMENTS: Record<string, TranscriptSegment[]> = {};
const EMPTY_REFS: string[] = [];

type Selection = { start: number; end: number; text: string };

/**
 * Aplica um comando de formatacao no editor nativo.
 *
 * O editor sabe o que e negrito, italico, codigo, titulo, lista e citacao:
 * o app so escolhe o comando.
 */
function applyFormat(editor: EnrichedTextInputInstance, type: FormatType): void {
  switch (type) {
    case 'bold':
      editor.toggleBold();
      break;
    case 'italic':
      editor.toggleItalic();
      break;
    case 'strike':
      editor.toggleStrikeThrough();
      break;
    case 'code':
      editor.toggleInlineCode();
      break;
    case 'heading':
      editor.toggleH2();
      break;
    case 'list':
      editor.toggleUnorderedList();
      break;
    case 'ordered':
      editor.toggleOrderedList();
      break;
    case 'quote':
      editor.toggleBlockQuote();
      break;
  }
}

const NativeNoteBody = memo(
  forwardRef<NoteBodyHandle, NoteBodyProps>(function NativeNoteBody(
    {
      value,
      onChangeMarkdown,
      imageSources = EMPTY_SOURCES,
      audioTranscripts = {},
      audioSegments = EMPTY_SEGMENTS,
      activeAudioRef,
      audioPlayer,
      audioStartMs,
      ownAudioRefs = EMPTY_REFS,
      transcribingWait,
      transcribingPercent,
      canTranscribe,
      onTranscribe,
      onStopTranscribe,
      onPlayAudio,
      onOpenTranscript,
      onEditTranscript,
      typography,
      onImageOpen,
      placeholder,
    },
    ref,
  ) {
  const styles = useThemedStyles(baseStyles);

    const window = useWindowDimensions();
    const [nodes, setNodes] = useState<NoteNode[]>(() => parseNoteDocument(value));
    const nodesRef = useRef(nodes);
    // Geracao dos trechos: o editor monta com o HTML do trecho. Quando o
    // documento muda por fora (ou uma midia divide um trecho), a geracao muda
    // e o trecho recebe o conteudo novo.
    const [version, setVersion] = useState(0);
    const editors = useRef(new Map<string, EnrichedTextInputInstance>());
    const selections = useRef(new Map<string, Selection>());
    const activeId = useRef<string | null>(null);
    const focused = useRef(false);
    const dirty = useRef(new Set<string>());
    /** Id das midias inseridas nesta sessao (o markdown nao guarda id). */
    const insertSeq = useRef(0);
    const { colors } = useTheme();

    /**
     * Formatacao pedida sem um trecho em foco (barra de acoes com a nota sem
     * cursor): ela entra quando o primeiro trecho recebe o foco.
     */
    const pendingFormat = useRef<FormatType | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const widthRef = useRef(Math.max(1, window.width));
    const [mountedAt] = useState(() => Date.now());
    const measuredOnce = useRef(false);

    const lastEmitted = useRef(value);
    const srcToRef = useRef(new Map<string, string>());
    const srcToAlt = useRef(new Map<string, string>());

    // Mapa URI exibivel -> referencia salva, para o HTML voltar a `local:`.
    useEffect(() => {
      for (const image of noteImages(value)) {
        const display = imageSources[image.ref];
        if (display) {
          srcToRef.current.set(display, image.ref);
          srcToAlt.current.set(display, image.alt);
        }
        srcToRef.current.set(image.ref, image.ref);
        srcToAlt.current.set(image.ref, image.alt);
      }
    }, [value, imageSources]);

    const emit = useCallback(
      (next: NoteNode[]) => {
        const markdown = serializeNoteDocument(next);
        if (markdown === lastEmitted.current) return;
        lastEmitted.current = markdown;
        onChangeMarkdown(markdown);
      },
      [onChangeMarkdown],
    );

    const editorFor = useCallback(
      (id: string | null | undefined): EnrichedTextInputInstance | null =>
        id ? (editors.current.get(id) ?? null) : null,
      [],
    );

    const registerEditor = useCallback(
      (id: string, instance: EnrichedTextInputInstance | null) => {
        if (!instance) {
          editors.current.delete(id);
          return;
        }
        editors.current.set(id, instance);
        // O editor pode remontar com o documento novo (midia inserida, nota
        // trocada por fora): se o trecho estava em foco, ele continua. Se havia
        // formatacao pedida sem editor em cena, ela entra agora.
        if (activeId.current !== id) return;
        setTimeout(() => {
          if (editors.current.get(id) !== instance) return;
          instance.focus();
          const type = pendingFormat.current;
          if (!type) return;
          pendingFormat.current = null;
          applyFormat(instance, type);
        }, 0);
      },
      [],
    );

    /**
     * Le o HTML de um trecho.
     *
     * As leituras sao **uma por vez por trecho**: o editor nativo responde a
     * um pedido por vez, e dois pedidos ao mesmo tempo fazem um deles falhar
     * ("Component unmounted") - e o texto que o usuario escreveu ia embora.
     */
    const flushChain = useRef(new Map<string, Promise<void>>());

    const flushNode = useCallback(
      (id: string): Promise<void> => {
        const previous = flushChain.current.get(id) ?? Promise.resolve();
        const run = previous.then(async () => {
          const editor = editorFor(id);
          if (!editor) return;
          let html: string;
          try {
            html = await editor.getHTML();
          } catch (error) {
            console.warn('[dyarium] falha ao ler o HTML do trecho', String(error));
            return;
          }
          const current = nodesRef.current.find(
            (node): node is NoteTextNode => node.kind === 'text' && node.id === id,
          );
          if (!current) return;
          const markdown = htmlToMarkdown(html, {
            imageRef: (src) => lookup(srcToRef.current, src),
            imageAlt: (src) => lookup(srcToAlt.current, src),
            width: widthRef.current,
          });
          // O texto do trecho e so o conteudo: as quebras que fecham a linha
          // antes de uma midia ficam no separador do no (o editor nao as
          // mostra) e nao entram aqui.
          if (current.markdown === markdown) return;
          const next = nodesRef.current.map((node) =>
            node.kind === 'text' && node.id === id ? { ...node, markdown } : node,
          );
          nodesRef.current = next;
          // O editor e a fonte enquanto o campo esta aberto. O estado do corpo
          // so e sincronizado no blur ou numa mudanca estrutural; atualizar aqui
          // fazia o campo nativo se redesenhar a cada pausa da digitacao.
          emit(next);
        });
        flushChain.current.set(id, run.catch(() => undefined));
        return run;
      },
      [editorFor, emit],
    );

    const flushNodes = useCallback(
      async (ids: string[]) => {
        if (timer.current) {
          clearTimeout(timer.current);
          timer.current = null;
        }
        for (const id of ids) await flushNode(id);
        for (const id of ids) dirty.current.delete(id);
      },
      [flushNode],
    );

    /**
     * Entrega o que pode ter texto novo: os trechos que receberam selecao e o
     * que esta em foco. Uma nota aberta e nao editada nao le HTML nenhum.
     */
    const flushPending = useCallback(async () => {
      const ids = new Set(dirty.current);
      if (activeId.current) ids.add(activeId.current);
      await flushNodes([...ids]);
    }, [flushNodes]);

    const syncFromRefs = useCallback(() => {
      setNodes(nodesRef.current);
    }, []);

    const removeNode = useCallback(
      async (id: string) => {
        // O texto pendente dos outros trechos precisa entrar no markdown antes
        // de remover a midia; senao a remocao levaria junto o que estava sendo
        // digitado.
        await flushNodes([...dirty.current]);
        // A edicao e na lista, nao no markdown: um id recalculado por um novo
        // parse apontaria para outro trecho e a foto "andaria" de lugar.
        const next = removeFromNoteNodes(nodesRef.current, id);
        nodesRef.current = next;
        selections.current.delete(id);
        dirty.current.delete(id);
        if (activeId.current === id) activeId.current = null;
        focused.current = false;
        setNodes(next);
        setVersion((current) => current + 1);
        emit(next);
      },
      [emit, flushNodes],
    );

    const confirmRemove = useCallback(
      (kind: 'foto' | 'áudio', id: string) => {
        Alert.alert(
          `Remover ${kind}?`,
          `A ${kind} sai do corpo da nota.`,
          [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Remover', style: 'destructive', onPress: () => void removeNode(id) },
          ],
        );
      },
      [removeNode],
    );

    /**
     * Redimensiona a foto: a largura vai para o markdown (`{w=50}`), e o que
     * mantem a foto do mesmo tamanho no app e no dashboard.
     */
    const resizeNode = useCallback(
      async (id: string, percent: number) => {
        // O texto pendente dos trechos precisa entrar no markdown antes: sem
        // isso, o resize devolveria a versao antiga do texto e apagaria o que
        // o usuario estava digitando.
        await flushNodes([...dirty.current]);
        const next = setWidthInNoteNodes(nodesRef.current, id, percent);
        if (next === nodesRef.current) return;
        nodesRef.current = next;
        // Sem remontar os trechos de texto: a estrutura do documento nao
        // mudou, e o editor nao pode perder o texto pendente.
        setNodes(next);
        emit(next);
      },
      [emit, flushNodes],
    );

    /**
     * Opcoes da foto: tamanho e, por ultimo, remover.
     *
     * Um unico botao de informacao no canto da foto abre a lista; a foto nao
     * tem mais "x" nem alca de redimensionar em cima do conteudo.
     */
    /** Foto com as opcoes abertas (tamanho e remover). */
    const [imageMenuId, setImageMenuId] = useState<string | null>(null);
    const imageMenu = nodes.find(
      (node): node is NoteImageNode => node.kind === 'image' && node.id === imageMenuId,
    );

    const scheduleFlush = useCallback(() => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        const ids = [...dirty.current];
        void (async () => {
          for (const id of ids) {
            await flushNode(id);
            // So sai o que foi lido: uma tecla durante a leitura continua
            // marcada para o proximo flush.
            dirty.current.delete(id);
          }
        })();
      }, FLUSH_MS);
    }, [flushNode]);

    const markDirty = useCallback(
      (id: string) => {
        dirty.current.add(id);
        scheduleFlush();
      },
      [scheduleFlush],
    );

    // Valor trocado por fora (dashboard, "ficar com o de la", audio anexado):
    // remonta os trechos com o documento novo, sem tocar no que esta sendo
    // digitado enquanto o valor nao mudar.
    useEffect(() => {
      if (value === lastEmitted.current) return;
      if (__DEV__ && process.env.NODE_ENV !== 'test') {
        // O corpo remontando tira o editor do lugar (o cursor pisca de novo):
        // e o que mostra quando isso acontece.
        console.log('[perf] note.rehydrate', {
          chars: value.length,
          nodes: parseNoteDocument(value).length,
        });
      }
      lastEmitted.current = value;
      const next = parseNoteDocument(value);
      nodesRef.current = next;
      dirty.current.clear();
      selections.current.clear();
      activeId.current = null;
      focused.current = false;
      // O documento mudou por fora: os editores recebem o conteudo novo.
      setNodes(next);
      setVersion((current) => current + 1);
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    }, [value]);

    // Imagem que chega depois so precisa remontar o texto quando ela esta
    // inline num no antigo. Foto como no proprio atualiza sozinha; remontar
    // todos os editores aqui fazia as letras/fonte piscarem na abertura.
    const previousSources = useRef(imageSources);
    useEffect(() => {
      if (previousSources.current === imageSources) return;
      previousSources.current = imageSources;
      const hasInlineImage = nodesRef.current.some(
        (node) => node.kind === 'text' && /!\[[^\]]*\]\([^)]*\)/.test(node.markdown),
      );
      if (!hasInlineImage) return;
      if (focused.current || dirty.current.size > 0) return;
      syncFromRefs();
      setVersion((current) => current + 1);
    }, [imageSources, syncFromRefs]);

    // Limpa o timer se a tela sair antes do debounce.
    useEffect(
      () => () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
      },
      [],
    );

    const handleSelection = useCallback(
      (id: string, event: NativeSyntheticEvent<OnChangeSelectionEvent>) => {
        const native = event.nativeEvent;
        selections.current.set(id, {
          start: native.start,
          end: native.end,
          text: native.text,
        });
        activeId.current = id;
        // O evento de selecao tambem chega quando o texto muda (e quando o
        // usuario so move o cursor). Marcar o trecho como sujo mantem o
        // autosave: o HTML so e lido no debounce, no blur ou na saida.
        markDirty(id);
      },
      [markDirty],
    );

    const handleEditorFocus = useCallback((id: string) => {
      activeId.current = id;
      focused.current = true;
    }, []);

    const handleEditorBlur = useCallback(
      (id: string) => {
        focused.current = false;
        // So o trecho que perdeu o foco pode ter texto novo: os outros ja
        // foram lidos no blur deles. Ler o corpo inteiro aqui fazia cada troca
        // de cursor entre trechos custar uma serializacao de HTML.
        void flushNodes([id]);
      },
      [flushNodes],
    );

    const handleEditorLayout = useCallback((event: LayoutChangeEvent) => {
      widthRef.current = Math.max(1, Math.round(event.nativeEvent.layout.width));
    }, []);

    /**
     * Foca o editor de um trecho.
     *
     * Todos os trechos de texto ja sao editores nativos: o toque chega direto
     * neles e o cursor e do proprio Android. Aqui so falta o foco quando o
     * pedido vem de fora (o titulo, a barra de acoes, a gravacao).
     */
    const focusNode = useCallback(
      (id: string) => {
        activeId.current = id;
        const editor = editorFor(id);
        if (editor) {
          editor.focus();
          // Formato pedido antes do foco (barra de acoes sem cursor): aplica
          // agora que o campo esta em edicao.
          const type = pendingFormat.current;
          if (!type) return;
          pendingFormat.current = null;
          applyFormat(editor, type);
          return;
        }
        // O trecho ainda nao montou (midia acabou de dividir o texto): o foco
        // entra assim que ele existir.
        setTimeout(() => {
          const mounted = editorFor(id);
          if (!mounted) return;
          mounted.focus();
          const type = pendingFormat.current;
          if (!type) return;
          pendingFormat.current = null;
          applyFormat(mounted, type);
        }, 60);
      },
      [editorFor],
    );

    const format = useCallback(
      (type: FormatType) => {
        const id = activeId.current;
        const editor = editorFor(id);
        if (!editor) {
          // A barra de acoes sem um trecho em foco: o primeiro trecho recebe o
          // foco e a formatacao, em vez de o botao nao fazer nada.
          const first = nodesRef.current.find(
            (node): node is NoteTextNode => node.kind === 'text',
          );
          if (!first) return;
          pendingFormat.current = type;
          focusNode(first.id);
          return;
        }
        applyFormat(editor, type);
        if (id) markDirty(id);
      },
      [editorFor, focusNode, markDirty],
    );

    const insert = useCallback(
      async (node: NoteImageNode | NoteAudioNode) => {
        const id = activeId.current;
        const selection = id ? selections.current.get(id) : null;
        const position = id && selection ? { nodeId: id, offset: selection.end } : null;
        // So os trechos tocados viram markdown antes de dividir: o no ativo e os
        // que ja estavam sujos. Numa nota longa, nao le o HTML de todos.
        const pendingIds = new Set(dirty.current);
        if (id) pendingIds.add(id);
        await flushNodes([...pendingIds]);
        // Id proprio da insercao: o no nao pode herdar o id de outro trecho (o
        // markdown, esse sim, e montado a partir da lista).
        insertSeq.current += 1;
        const placed = { ...node, id: `${node.kind}${insertSeq.current}` };
        const next = insertIntoNoteNodes(nodesRef.current, placed, position);
        nodesRef.current = next;
        selections.current.clear();
        dirty.current.clear();
        focused.current = false;

        // Coloca o cursor no trecho seguinte (ou no ultimo de texto) e garante
        // que ele esteja montado, mesmo que ainda seja um dos ultimos.
        const at = next.findIndex((item) => item.id === placed.id);
        const after = next
          .slice(at + 1)
          .find((item): item is NoteTextNode => item.kind === 'text');
        const fallback = [...next]
          .reverse()
          .find((item): item is NoteTextNode => item.kind === 'text');
        const target = after ?? fallback;
        // O documento mudou (o trecho foi dividido): os editores remontam com o
        // HTML novo e o cursor entra no trecho que ficou depois da midia.
        setNodes(next);
        setVersion((current) => current + 1);
        emit(next);

        if (target) {
          activeId.current = target.id;
          setTimeout(() => editorFor(target.id)?.focus(), 60);
        }
      },
      [editorFor, emit, flushNodes],
    );

    useImperativeHandle(
      ref,
      () => ({
        focus() {
          const id =
            activeId.current ??
            nodesRef.current.find((node): node is NoteTextNode => node.kind === 'text')?.id;
          if (!id) return;
          focusNode(id);
        },
        blur() {
          editorFor(activeId.current)?.blur();
          activeId.current = null;
          focused.current = false;
        },
        format,
        insertImage(
          displaySrc,
          persistSrc,
          alt,
          widthPercent = DEFAULT_IMAGE_WIDTH,
          naturalWidth,
          naturalHeight,
        ) {
          if (naturalWidth && naturalHeight && naturalHeight > 0) {
            rememberImageRatio(displaySrc, naturalWidth / naturalHeight);
          }
          void insert({
            kind: 'image',
            id: 'insert',
            ref: persistSrc,
            alt,
            width: clampImageWidth(widthPercent),
          });
        },
        insertAudio(ref, durationMs = 0) {
          void insert({ kind: 'audio', id: 'insert', ref, durationMs });
        },
        insertLink(url) {
          const id = activeId.current;
          const editor = editorFor(id);
          if (!editor) return;
          const selection = id ? selections.current.get(id) : null;
          const start = selection?.start ?? 0;
          const end = selection?.end ?? 0;
          const label = selection?.text.trim() || url;
          editor.setLink(start, end, label, url);
          if (id) markDirty(id);
        },
        getInsertPosition() {
          const id = activeId.current;
          const selection = id ? selections.current.get(id) : null;
          return id && selection ? { nodeId: id, offset: selection.end } : null;
        },
        async flush() {
          await flushPending();
        },
      }),
      [editorFor, flushPending, focusNode, format, insert, markDirty],
    );

    const textStyle = useMemo(
      () => ({
        color: colors.text,
        fontFamily: fontFamilyNative(typography?.family ?? 'system'),
        fontSize: typography?.size ?? 16,
        fontWeight: fontWeightNative(typography?.weight ?? 'regular'),
        lineHeight: noteLineHeight(typography?.size ?? 16),
        letterSpacing: NOTE_LETTER_SPACING,
        padding: 0,
        minHeight: MIN_TEXT_HEIGHT,
      }),
      [typography, colors],
    );

    const htmlStyle = useMemo<HtmlStyle>(() => noteHtmlStyle(typography, colors), [typography, colors]);

    const renderNode = (node: NoteNode, first: boolean) => {
      if (node.kind === 'text') {
        return (
          <TextNodeEditor
            key={`${version}-${node.id}`}
            id={node.id}
            markdown={node.markdown}
            width={Math.max(1, window.width)}
            imageSources={imageSources}
            placeholder={first ? placeholder : undefined}
            style={textStyle}
            htmlStyle={htmlStyle}
            onReady={registerEditor}
            onSelection={handleSelection}
            onFocus={handleEditorFocus}
            onBlur={handleEditorBlur}
            onLayout={handleEditorLayout}
          />
        );
      }

      if (node.kind === 'image') {
        return (
          <ImageBlock
            key={node.id}
            node={node}
            src={imageSources[node.ref]}
            onOpen={onImageOpen}
            onOptions={() => setImageMenuId(node.id)}
          />
        );
      }

      const own = ownAudioRefs.includes(node.ref);
      return (
        <NoteAudioCard
          key={node.id}
          node={node}
          transcript={audioTranscripts[node.ref]}
          segments={audioSegments[node.ref]}
          active={activeAudioRef === node.ref}
          player={activeAudioRef === node.ref ? audioPlayer : null}
          startMs={activeAudioRef === node.ref ? audioStartMs : null}
          transcribingPercent={own ? transcribingPercent : undefined}
          transcribingWait={own && transcribingWait}
          canTranscribe={own && canTranscribe}
          onTranscribe={own ? onTranscribe : undefined}
          onStopTranscribe={own ? onStopTranscribe : undefined}
          onPlay={() => onPlayAudio?.(node.ref)}
          onPlayFrom={(startMs) => onPlayAudio?.(node.ref, startMs)}
          onOpenTranscript={own ? onOpenTranscript : undefined}
          onEditTranscript={own ? onEditTranscript : undefined}
          onRemove={() => confirmRemove('áudio', node.id)}
        />
      );
    };

    return (
      <View
        testID="note-body"
        style={{ gap: spacing.xs }}
        onLayout={(event: LayoutChangeEvent) => {
          widthRef.current = Math.max(1, Math.round(event.nativeEvent.layout.width));
          if (!measuredOnce.current) {
            measuredOnce.current = true;
            // Marco de desenvolvimento: do mount do corpo ate o primeiro layout
            // (mostra no resumo [perf] se a abertura gastou no editor nativo).
            mark('note.body_layout_ms', Date.now() - mountedAt);
          }
        }}
      >
        {nodes.map((node, index) => renderNode(node, index === 0))}

        {/* Opcoes da foto: tamanho e, por ultimo, remover. Um menu proprio (e
            nao um Alert) porque o Alert do Android mostra no maximo tres
            botoes, e o remover sumia da lista. */}
        {imageMenu ? (
          <FastModal visible transparent onRequestClose={() => setImageMenuId(null)}>
            <Press style={styles.sheetBackdrop} onPress={() => setImageMenuId(null)} feedback={false}>
              <View style={styles.sheet}>
                <Text style={styles.sheetTitle}>Foto</Text>
                {IMAGE_WIDTH_OPTIONS.map((option) => (
                  <Press
                    key={option.label}
                    style={styles.sheetRow}
                    accessibilityRole="button"
                    onPress={() => {
                      setImageMenuId(null);
                      void resizeNode(imageMenu.id, option.percent);
                    }}
                  >
                    <Text style={styles.sheetText}>{option.label}</Text>
                  </Press>
                ))}
                <Press
                  style={styles.sheetRow}
                  accessibilityRole="button"
                  onPress={() => {
                    setImageMenuId(null);
                    void removeNode(imageMenu.id);
                  }}
                >
                  <Text style={[styles.sheetText, styles.sheetDanger]}>Remover foto</Text>
                </Press>
              </View>
            </Press>
          </FastModal>
        ) : null}
      </View>
    );
  }),
);

/**
 * Um no de texto com o seu proprio editor. O HTML inicial e calculado uma vez
 * no mount; o pai so remonta o trecho quando o documento muda por fora.
 *
 * Memoizado: o editor e caro (uma view nativa de texto rico) e nao pode
 * remontar por causa de uma mudanca que nao e dele.
 */
const TextNodeEditor = memo(function TextNodeEditor({
  id,
  markdown,
  width,
  imageSources,
  placeholder,
  style,
  htmlStyle,
  onReady,
  onSelection,
  onFocus,
  onBlur,
  onLayout,
}: {
  id: string;
  markdown: string;
  width: number;
  imageSources: Record<string, string>;
  placeholder?: string;
  style: EnrichedInputStyle;
  htmlStyle: HtmlStyle;
  onReady: (id: string, instance: EnrichedTextInputInstance | null) => void;
  onSelection: (id: string, event: NativeSyntheticEvent<OnChangeSelectionEvent>) => void;
  onFocus: (id: string) => void;
  onBlur: (id: string) => void;
  onLayout: (event: LayoutChangeEvent) => void;
}) {
  const { colors } = useTheme();

  const ref = useRef<EnrichedTextInputInstance>(null);
  const [html] = useState(() =>
    markdownToHtml(markdown, {
      imageSrc: (imageRef) => imageSources[imageRef] ?? imageRef,
      imageRatio: (src) => imageRatio(src),
      width,
    }),
  );

  useEffect(() => {
    onReady(id, ref.current);
    return () => onReady(id, null);
  }, [id, onReady]);

  // Os callbacks sao fixos por trecho: o editor e memoizado e nao pode
  // remontar (a view nativa e cara) por causa de uma funcao nova.
  const handleSelection = useCallback(
    (event: NativeSyntheticEvent<OnChangeSelectionEvent>) => onSelection(id, event),
    [id, onSelection],
  );
  const handleFocus = useCallback(() => onFocus(id), [id, onFocus]);
  const handleBlur = useCallback(() => onBlur(id), [id, onBlur]);

  return (
    <EnrichedTextInput
      ref={ref}
      defaultValue={html}
      placeholder={placeholder}
      placeholderTextColor={colors.textTertiary}
      cursorColor={colors.accent}
      selectionColor={colors.accent}
      scrollEnabled={false}
      style={style}
      htmlStyle={htmlStyle}
      linkRegex={null}
      textShortcuts={[]}
      // Eventos sincronos no Android: o editor muda de tamanho a cada tecla
      // (o texto cresce) e, com o evento assincrono, a atualizacao chega
      // depois do quadro - o campo pisca e a digitacao engasga. E a opcao que
      // a propria biblioteca indica para esse caso.
      androidExperimentalSynchronousEvents
      onChangeSelection={handleSelection}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onLayout={onLayout}
    />
  );
});

/** Foto do documento, com a largura em percentual da nota. */
function ImageBlock({
  node,
  src,
  onOpen,
  onOptions,
}: {
  node: NoteImageNode;
  src?: string;
  onOpen?: (src: string) => void;
  /** Abre as opcoes da foto (tamanho e remover). */
  onOptions: () => void;
}) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  const [ratio, setRatio] = useState(() => (src ? (cachedImageRatio(src) ?? 4 / 3) : 4 / 3));

  useEffect(() => {
    if (!src) return undefined;
    let alive = true;
    void measureImageRatio(src).then((measured) => {
      if (alive && measured) setRatio(measured);
    });
    return () => {
      alive = false;
    };
  }, [src]);

  return (
    <View style={[styles.imageBlock, { width: `${node.width}%` }]}>
      {src ? (
        <Press
          onPress={() => onOpen?.(src)}
          accessibilityRole="imagebutton"
          accessibilityLabel={node.alt || 'Foto da nota'}
        >
          <Image
            source={{ uri: src }}
            style={[styles.image, { aspectRatio: ratio }]}
            resizeMode="cover"
          />
        </Press>
      ) : (
        <View style={styles.imagePlaceholder}>
          <Ionicons name="image-outline" size={20} color={colors.textTertiary} />
          <Text style={styles.imagePlaceholderText}>Foto</Text>
        </View>
      )}
      <Press
        style={styles.imageInfo}
        onPress={onOptions}
        accessibilityLabel="Opções da foto"
        hitSlop={10}
      >
        <Ionicons name="information-circle-outline" size={18} color={colors.text} />
      </Press>
    </View>
  );
}

/** Busca uma URI no mapa, tolerando a codificacao que o editor pode devolver. */
function lookup(map: Map<string, string>, src: string): string | undefined {
  const found = map.get(src);
  if (found !== undefined) return found;
  try {
    const decoded = decodeURIComponent(src);
    const fromDecoded = map.get(decoded);
    if (fromDecoded !== undefined) return fromDecoded;
  } catch {
    // URI com % invalido: tenta a forma codificada abaixo.
  }
  try {
    const encoded = encodeURI(src);
    return map.get(encoded);
  } catch {
    return undefined;
  }
}

export const NoteBody = NativeNoteBody;

const baseStyles = defineStyles({
  image: {
    borderRadius: radius.md,
    backgroundColor: baseColors.surface,
  },
  imagePlaceholder: {
    minHeight: 84,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: baseColors.border,
    backgroundColor: baseColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  imagePlaceholderText: { color: baseColors.textTertiary, fontSize: 12 },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: baseColors.overlay,
  },
  sheet: {
    margin: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: baseColors.bgElevated,
    paddingVertical: spacing.xs,
  },
  sheetTitle: {
    color: baseColors.textSecondary,
    fontSize: 13,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  sheetRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  sheetText: { color: baseColors.text, fontSize: 16 },
  sheetDanger: { color: baseColors.danger },
  imageBlock: {
    // A foto tem largura propria (percentual da nota) e a altura vem da
    // proporcao conhecida: o bloco nao muda de tamanho quando a imagem carrega.
    minHeight: 40,
  },
  imageInfo: {
    // Um unico botao, no canto: informacao abre tamanho e remover.
    position: 'absolute',
    top: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: baseColors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
