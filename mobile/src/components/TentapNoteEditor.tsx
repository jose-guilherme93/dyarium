/**
 * Corpo da nota no editor TenTap (TipTap/ProseMirror dentro de um WebView).
 *
 * O markdown continua sendo o formato salvo; este componente so faz a ponte
 * markdown <-> HTML. O editor tem altura fixa e rola por dentro; o navegador
 * mantem a linha sendo digitada visivel.
 */

import {
  LinkBridge,
  PlaceholderBridge,
  RichText,
  TenTapStartKit,
  darkEditorTheme,
  useBridgeState,
  useEditorBridge,
} from '@10play/tentap-editor';
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { DEFAULT_IMAGE_WIDTH } from '@/core/image';
import { markdownToTentapHtml, tentapHtmlToMarkdown } from '@/core/tentapMarkdown';
import {
  fontFamilyCss,
  fontWeightCss,
  type NoteTypography,
} from '@/core/typography';
import { colors, radius, spacing } from '@/theme/tokens';

// Entrega o markdown ao app so depois de uma pausa longa, no blur ou no flush.
// Cada entrega serializa o documento inteiro pelo bridge (dezenas a centenas de
// ms); fazer isso a cada 700 ms de pausa travava a digitacao.
const COMMIT_DELAY_MS = 2500;

/** O WebView e 16px mais largo que a area visivel; o recorte esconde a barra. */
const editorFill = { flex: 1, marginRight: -16 } as const;
/** Container do WebView: sem isto, com `dynamicHeight` desligado, altura zero. */
const editorContainer = { flex: 1 } as const;

/** Formatos que a barra de acoes da nota aplica no editor. */
export type NoteFormat =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'heading'
  | 'list'
  | 'ordered'
  | 'quote';

export interface NoteBodyEditorHandle {
  focus(): void;
  format(type: NoteFormat): void;
  /** Insere a foto no cursor: `displaySrc` e a previa; `persistSrc` e a URL salva. */
  insertImage(displaySrc: string, persistSrc: string, alt: string, widthPercent?: number): void;
  insertLink(url: string, label?: string): void;
  /** Entrega o markdown pendente ao chamador antes de desmontar/navegar. */
  flush(): Promise<void>;
}

interface NoteBodyEditorProps {
  value: string;
  onChangeMarkdown: (markdown: string) => void;
  /** Avisa quando o editor ganha/perde foco (a transcricao local espera). */
  onEditingChange?: (editing: boolean) => void;
  /** Avisa quando o editor terminou de montar (acoes iniciais da tela). */
  onReady?: () => void;
  /** Toque numa foto: abre a foto em tela cheia. */
  onImageOpen?: (src: string) => void;
  placeholder?: string;
  /** Mapa URL persistida -> fonte de exibicao (arquivo local/URL). */
  imageSources?: Record<string, string>;
  /** Pasta da nota, para o WebView carregar as imagens `file://`. */
  baseUrl?: string;
  typography?: NoteTypography;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Larguras percentuais conhecidas (as opcoes do app e larguras antigas). */
function widthCss(): string {
  const rules: string[] = [];
  for (let percent = 15; percent <= 100; percent += 1) {
    rules.push(`.ProseMirror img[width="${percent}%"]{width:${percent}%}`);
  }
  return rules.join('\n');
}

function editorCss(typography: NoteTypography): string {
  const lineHeight = Math.round(typography.size * 1.5);
  const size = typography.size;
  return `
    html, body { overflow: hidden; background: #000000; }
    /* O corpo rola dentro do WebView (altura fixa). A barra de rolagem fica
       invisivel: largura zero e, se o navegador insistir, toda preta como o
       fundo. A rolagem continua funcionando. */
    ::-webkit-scrollbar { width: 0 !important; height: 0 !important; background: #000000; }
    ::-webkit-scrollbar-track { background: #000000; }
    ::-webkit-scrollbar-thumb { background: #000000; }
    * { scrollbar-width: none; -ms-overflow-style: none; }
    html, body, #root, .tentap-root { background: #000000; margin: 0; padding: 0; }
    .ProseMirror, .ProseMirror * { background-color: transparent; }
    .ProseMirror {
      font-family: ${fontFamilyCss(typography.family)};
      font-size: ${size}px;
      font-weight: ${fontWeightCss(typography.weight)};
      line-height: ${lineHeight}px;
      color: ${colors.text};
      padding: 0 16px 0 0;
      outline: none;
      min-height: ${lineHeight}px;
    }
    .ProseMirror p { margin: 0 0 ${spacing.sm}px; }
    .ProseMirror > :last-child { margin-bottom: 0; }
    .ProseMirror h1 { font-size: ${Math.round(size * 1.6)}px; line-height: 1.3; font-weight: 700; margin: ${spacing.sm}px 0; }
    .ProseMirror h2 { font-size: ${Math.round(size * 1.35)}px; line-height: 1.3; font-weight: 700; margin: ${spacing.sm}px 0; }
    .ProseMirror h3 { font-size: ${Math.round(size * 1.15)}px; line-height: 1.3; font-weight: 700; margin: ${spacing.sm}px 0; }
    .ProseMirror a { color: ${colors.accentStrong}; text-decoration: underline; }
    .ProseMirror ul, .ProseMirror ol { padding-left: 22px; margin: 0 0 ${spacing.sm}px; }
    .ProseMirror li p { margin: 0; }
    .ProseMirror blockquote {
      border-left: 3px solid ${colors.borderStrong};
      margin: 0 0 ${spacing.sm}px;
      padding-left: ${spacing.md}px;
      color: ${colors.textSecondary};
    }
    .ProseMirror code {
      color: ${colors.warning};
      background-color: ${colors.surfaceElevated};
      border-radius: 4px;
      padding: 1px 3px;
    }
    .ProseMirror img {
      height: auto;
      max-width: 100%;
      border-radius: ${radius.md}px;
      display: block;
      margin: ${spacing.sm}px 0;
    }
    ${widthCss()}
    .ProseMirror-selectednode { outline: 2px solid ${colors.accent}; }
    .ProseMirror .is-editor-empty:first-child::before { color: ${colors.textTertiary}; }
    .ProseMirror ::selection { background-color: ${colors.accent}; }
  `;
}

/**
 * Corpo da nota: editor rico nativo? Nao: TenTap em WebView. O titulo, o player
 * e os metadados continuam nativos; so o texto/fotos ficam aqui.
 */
export const TentapNoteEditor = memo(
  forwardRef<NoteBodyEditorHandle, NoteBodyEditorProps>(function TentapNoteEditor(
    {
      value,
      onChangeMarkdown,
      onEditingChange,
      onReady,
      onImageOpen,
      placeholder = 'Escreva...',
      imageSources = {},
      baseUrl,
      typography,
    },
    ref,
  ) {
    // O HTML inicial e imutavel; mudanca externa de texto remonta o componente
    // pelo `key` da tela (como o editor de blocos fazia).
    const [initialHtml] = useState(() => markdownToTentapHtml(value, imageSources));
    const lastMarkdown = useRef(value);
    const sourcesRef = useRef(imageSources);
    // Imagens inseridas neste mount: a tela atualiza `imageSources` no mesmo
    // instante, mas o efeito que copia a prop pode nao ter rodado antes de um
    // flush imediato (sair da nota logo depois de inserir a foto).
    const insertedSources = useRef<Record<string, string>>({});
    const onChangeRef = useRef(onChangeMarkdown);
    const onEditingRef = useRef(onEditingChange);
    const onReadyRef = useRef(onReady);
    const onImageOpenRef = useRef(onImageOpen);
    const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const scheduleRef = useRef<() => void>(() => undefined);
    const readyFired = useRef(false);
    const focused = useRef(false);
    // O editor avisa mudanca tambem ao carregar/normalizar o HTML. So vale
    // salvar depois que o usuario tocou ou usou uma acao (evita marcar a nota
    // como suja so por abrir).
    const interacted = useRef(false);

    useEffect(() => {
      sourcesRef.current = imageSources;
    }, [imageSources]);
    useEffect(() => {
      onChangeRef.current = onChangeMarkdown;
    }, [onChangeMarkdown]);
    useEffect(() => {
      onEditingRef.current = onEditingChange;
    }, [onEditingChange]);
    useEffect(() => {
      onReadyRef.current = onReady;
    }, [onReady]);
    useEffect(() => {
      onImageOpenRef.current = onImageOpen;
    }, [onImageOpen]);

    const editor = useEditorBridge({
      initialContent: initialHtml,
      // O editor tem altura fixa e rola por dentro: e o navegador que mantem a
      // linha visivel ao digitar, sem scrollTo.
      dynamicHeight: false,
      webviewBaseURL: baseUrl,
      theme: {
        ...darkEditorTheme,
        // Fundo solido igual ao da tela: WebView transparente pisca no Android
        // ao rolar/repintar (e a nota deve parecer um corpo so, sem emenda).
        webview: { backgroundColor: '#000000' },
        webviewContainer: { backgroundColor: '#000000' },
      },
      bridgeExtensions: [
        ...TenTapStartKit,
        PlaceholderBridge.configureExtension({ placeholder }),
        // `note:` e a mencao a outra nota do dashboard; sem esse protocolo o
        // link seria descartado ao carregar o HTML.
        LinkBridge.configureExtension({ openOnClick: false, protocols: ['note'] }),
      ],
      rpcTimeoutMs: 5000,
      // O editor tambem avisa ao carregar/normalizar o HTML. So agenda depois
      // que o usuario focou: abrir a nota nao pode marca-la como suja.
      onChange: () => {
        if (!focused.current) return;
        scheduleRef.current();
      },
    });

    const state = useBridgeState(editor);

    const commit = useCallback(async () => {
      if (commitTimer.current) {
        clearTimeout(commitTimer.current);
        commitTimer.current = null;
      }
      if (!readyFired.current || !interacted.current) return;
      try {
        const html = await editor.getHTML();
        const markdown = tentapHtmlToMarkdown(html, {
          ...sourcesRef.current,
          ...insertedSources.current,
        }).trimEnd();
        if (markdown === lastMarkdown.current.trimEnd()) return;
        lastMarkdown.current = markdown;
        onChangeRef.current(markdown);
      } catch {
        // O WebView pode estar trocando de pagina; a proxima mudanca tenta de novo.
      }
    }, [editor]);

    const schedule = useCallback(() => {
      if (commitTimer.current) clearTimeout(commitTimer.current);
      commitTimer.current = setTimeout(() => {
        commitTimer.current = null;
        void commit();
      }, COMMIT_DELAY_MS);
    }, [commit]);

    useEffect(() => {
      scheduleRef.current = schedule;
    }, [schedule]);

    useEffect(
      () => () => {
        if (commitTimer.current) clearTimeout(commitTimer.current);
      },
      [],
    );

    // Estilo/tipografia e placeholder sao aplicados depois de o editor existir;
    // `injectCSS`/`setPlaceholder` enfileiram antes do primeiro load.
    useEffect(() => {
      if (!typography) return;
      editor.injectCSS(editorCss(typography), 'dyarium-typography');
    }, [editor, typography]);

    useEffect(() => {
      editor.setPlaceholder(placeholder);
    }, [editor, placeholder]);

    useEffect(() => {
      if (!state.isReady || readyFired.current) return;
      readyFired.current = true;
      onReadyRef.current?.();
    }, [state.isReady]);

    useEffect(() => {
      if (state.isFocused === focused.current) return;
      focused.current = state.isFocused;
      if (state.isFocused) interacted.current = true;
      onEditingRef.current?.(state.isFocused);
    }, [state.isFocused]);

    useEffect(() => {
      // As imagens que faltavam baixam em segundo plano. Atualiza o `src` no
      // DOM sem `setContent`: reaplicar o documento inteiro apagaria o que o
      // usuario ja digitou. O markdown salvo continua usando a referencia pelo
      // mapa inverso do `tentapHtmlToMarkdown`.
      editor.injectJS(`
        (function (sources) {
          var images = document.querySelectorAll('img');
          for (var i = 0; i < images.length; i += 1) {
            var image = images[i];
            var current = image.getAttribute('src') || '';
            var next = sources[current];
            if (next && next !== current) {
              image.setAttribute('src', '');
              image.setAttribute('src', next);
            }
          }
        })(${JSON.stringify(imageSources)});
        true;
      `);
    }, [editor, imageSources]);

    // Toque numa foto abre a visualizacao nativa. Tambem mantem a linha sendo
    // digitada tres linhas acima da base do editor, rolando por dentro do
    // proprio WebView (sem scrollTo nativo). `exclusivelyUseCustomOnMessage`
    // mantem as mensagens do TenTap funcionando.
    useEffect(() => {
      editor.injectJS(`
        (function () {
          if (!window.__dyariumImageTap) {
            window.__dyariumImageTap = true;
            document.addEventListener('click', function (event) {
              var target = event.target;
              if (!target || target.tagName !== 'IMG') return;
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'dyarium-image',
                src: target.getAttribute('src') || ''
              }));
            }, true);
          }
          if (window.__dyariumReveal) return;
          window.__dyariumReveal = true;
          var scroller = document.querySelector('.tentap-root') || document.scrollingElement;
          var reveal = function () {
            if (!scroller) return;
            var selection = window.getSelection();
            if (!selection || selection.rangeCount === 0) return;
            var rect = selection.getRangeAt(0).getBoundingClientRect();
            if (!rect || (rect.width === 0 && rect.height === 0)) return;
            var editor = document.querySelector('.ProseMirror');
            var line = editor ? parseFloat(getComputedStyle(editor).lineHeight) : 24;
            if (!isFinite(line) || line <= 0) line = 24;
            var view = scroller.getBoundingClientRect();
            var limit = view.bottom - 3 * line;
            if (rect.bottom > limit) {
              scroller.scrollTo({
                top: scroller.scrollTop + (rect.bottom - limit),
                behavior: 'smooth'
              });
            }
          };
          document.addEventListener('selectionchange', reveal);
          window.addEventListener('resize', function () { setTimeout(reveal, 60); });
          if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', function () { setTimeout(reveal, 60); });
          }
        })();
        true;
      `);
    }, [editor]);

    const onMessage = useCallback((event: { nativeEvent: { data: string } }) => {
      if (!event.nativeEvent.data.includes('dyarium-image')) return;
      try {
        const message = JSON.parse(event.nativeEvent.data) as { type?: string; src?: string };
        if (message.type === 'dyarium-image' && message.src) {
          onImageOpenRef.current?.(message.src);
        }
      } catch {
        // Outras mensagens do TenTap nao sao nossas.
      }
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        focus() {
          editor.focus('end');
        },
        format(type) {
          interacted.current = true;
          if (type === 'bold') editor.toggleBold();
          else if (type === 'italic') editor.toggleItalic();
          else if (type === 'strike') editor.toggleStrike();
          else if (type === 'code') editor.toggleCode();
          else if (type === 'heading') editor.toggleHeading(2);
          else if (type === 'ordered') editor.toggleOrderedList();
          else if (type === 'quote') editor.toggleBlockquote();
          else editor.toggleBulletList();
          schedule();
        },
        insertImage(displaySrc, persistSrc, alt, widthPercent = DEFAULT_IMAGE_WIDTH) {
          interacted.current = true;
          insertedSources.current[persistSrc] = displaySrc;
          const width = ` width="${Math.round(widthPercent)}%"`;
          editor.insertContent(
            `<img src="${escapeAttr(displaySrc)}" alt="${escapeAttr(alt)}"${width}><p></p>`,
          );
          schedule();
        },
        insertLink(url, label) {
          interacted.current = true;
          const selection = editor.getEditorState().selection;
          if (selection.from !== selection.to) {
            editor.setLink(url);
          } else {
            const text = label?.trim() || url;
            editor.insertContent(
              `<a href="${escapeAttr(url)}">${escapeText(text)}</a>`,
            );
          }
          schedule();
        },
        async flush() {
          await commit();
        },
      }),
      [commit, editor, schedule],
    );

    return (
      <RichText
        // 16px alem da area visivel: a barra de rolagem nativa do WebView cai
        // nessa faixa e e recortada pelo container.
        style={editorFill}
        containerStyle={editorContainer}
        editor={editor}
        onMessage={onMessage}
        exclusivelyUseCustomOnMessage={false}
        originWhitelist={['*']}
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        keyboardDisplayRequiresUserAction={false}
        overScrollMode="never"
      />
    );
  }),
);
