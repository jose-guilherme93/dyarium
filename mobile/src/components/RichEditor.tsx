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
import { Linking, StyleSheet, TextInput, TurboModuleRegistry, View } from 'react-native';

import {
  applyMarkdownFormat,
  htmlToMarkdown,
  markdownToHtml,
  removeImageFromMarkdown,
  setImageWidthInMarkdown,
  type FormatType,
} from '@/core/richText';
import {
  DEFAULT_TYPOGRAPHY,
  fontFamilyCss,
  fontWeightCss,
  type NoteTypography,
} from '@/core/typography';
import { useRenderCount } from '@/dev/perf';
import { colors, fontSize, spacing } from '@/theme/tokens';

export interface RichEditorHandle {
  format(type: FormatType): void;
  focus(): void;
  /** Insere imagem no cursor: `displaySrc` e a previa; `persistSrc` e a URL salva. */
  insertImage(displaySrc: string, persistSrc: string, alt: string): void;
  /** Insere um link no cursor (rotulo = texto; sem rotulo, usa a URL). */
  insertLink(url: string, label?: string): void;
  /** Muda a largura de uma imagem existente (percentual da largura da nota). */
  setImageWidth(key: string, widthPercent: number): void;
  /** Apaga uma imagem existente. */
  deleteImage(key: string): void;
  /** Apaga o bloco somente leitura (tabela, divisoria) pelo markdown que ele carrega. */
  deleteOpaque(markdown: string): void;
}

interface RichEditorProps {
  value: string;
  onChangeMarkdown: (markdown: string) => void;
  /** Avisa quando o editor ganha foco (o usuario tocou para escrever). */
  onEditingChange?: (editing: boolean) => void;
  /** Avisa quando o HTML terminou de carregar (editor pronto para comandos). */
  onReady?: () => void;
  /**
   * Posicao do cursor (limite inferior, em px) dentro do editor. A tela usa
   * para rolar a nota e nao deixar o teclado cobrir o que esta sendo escrito.
   */
  onCaret?: (y: number) => void;
  /** Toque curto numa imagem: abre a foto em tela cheia. */
  onImageOpen?: (src: string) => void;
  /** Toque longo numa imagem: menu com largura e apagar. */
  onImageMenu?: (src: string, width: number) => void;
  placeholder?: string;
  /** Mapa URL original -> fonte de exibicao (ex.: `file://` local) para imagens. */
  imageSources?: Record<string, string>;
  /** Base `file://` (pasta da nota) para o WebView carregar as imagens locais. */
  baseUrl?: string;
  /** Tipografia do editor (familia, tamanho e peso). */
  typography?: NoteTypography;
  /** Altura minima: o editor preenche o espaco restante da nota (digitar em qualquer lugar). */
  minHeight?: number;
  /**
   * Largura maxima da linha de texto, em px. A coluna fica centralizada, com o
   * mesmo espaco dos dois lados (como um documento de texto).
   */
  measure?: number;
  /** Toque num bloco que o app nao edita (tabela, divisoria): abre a acao de apagar. */
  onOpaqueMenu?: (opaque: { label: string; markdown: string }) => void;
}

// O modulo nativo do WebView so existe depois de um novo build. Enquanto nao
// existir, cai para um editor simples (com marcadores) para nao quebrar o app.
const hasWebView = Boolean(TurboModuleRegistry.get('RNCWebViewModule'));

/**
 * Largura maxima da linha de texto, em px. Acima disso a linha fica longa demais
 * de ler; abaixo, sobra espaco de sobra. O editor aplica isso como CSS
 * (max-width), entao o WebView responsivo faz o resto.
 */
export const DEFAULT_MEASURE = 680;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const WebViewModule = hasWebView ? require('react-native-webview') : null;

export function buildEditorHtml(
  placeholder: string,
  initialHtml: string,
  typography: NoteTypography = DEFAULT_TYPOGRAPHY,
  measure = 720,
): string {
  const safePlaceholder = placeholder.replace(/"/g, '&quot;');
  const fontFamily = fontFamilyCss(typography.family);
  const fontWeight = fontWeightCss(typography.weight);
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<style>
  /* Fundo transparente: a cor vem da tela da nota. Com fundo proprio aqui, a
     nota aparecia com duas cores (o painel do editor sobre o fundo do app). */
  html, body { margin: 0; padding: 0; height: 100%; background: transparent; color: #FFFFFF; font-family: ${fontFamily}; font-size: ${typography.size}px; font-weight: ${fontWeight}; line-height: 1.5; word-wrap: break-word; -webkit-text-size-adjust: none; }
  /* box-sizing: sem ele o padding de #editor (8px) soma ao min-height: 100% e o
     editor cresce a cada ciclo do ResizeObserver (a nota crescia sem parar). */
  #editor { box-sizing: border-box; min-height: 100%; padding: 4px 0; outline: none; }
  /* Coluna com medida e centralizada, como um documento: a linha para em ~${measure}px
     e sobra espaco igual dos dois lados, em vez de texto colado na borda. */
  #editor > * { max-width: ${measure}px; margin-left: auto; margin-right: auto; }
  #editor:empty:before { content: attr(data-placeholder); color: #5A5A5F; }
  ul { padding-left: 22px; margin: 6px 0; }
  div { min-height: 1.5em; }
  a { color: #8B7BE8; text-decoration: underline; }
  h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 18px 0 6px; font-weight: 700; }
  h1 { font-size: 1.6em; }
  h2 { font-size: 1.35em; }
  h3 { font-size: 1.15em; }
  blockquote { margin: 10px 0; padding: 2px 0 2px 12px; border-left: 3px solid #3A3A45; color: #C9C9D2; }
  pre.code-block { margin: 10px 0; padding: 10px 12px; border-radius: 10px; background: #15151B; border: 1px solid #2A2A33; overflow-x: auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.88em; line-height: 1.45; white-space: pre-wrap; }
  /* Bloco opaco: o que o app nao edita (tabela, divisoria). Fica visivel, nunca
     some, e carrega o markdown original em data-md. */
  .opaque-block { display: block; margin: 10px 0; padding: 8px 10px; border: 1px dashed #3A3A45; border-radius: 10px; background: rgba(255,255,255,0.03); }
  .opaque-kind { display: block; font-size: 0.7em; letter-spacing: 0.08em; text-transform: uppercase; color: #6E6E7A; margin-bottom: 4px; }
  .opaque-preview { display: block; font-size: 0.9em; color: #A9A9B5; }
  .opaque-inline { padding: 1px 6px; border-radius: 6px; background: rgba(139,123,232,0.16); color: #B9AEF5; }
  .img-block { position: relative; display: block; margin: 6px 0; }
  .img-block img { display: block; max-width: 100%; border-radius: 10px; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
  /* Sem largura definida = largura total da nota (o padrao da foto e preencher). */
  .img-block img:not([data-width]) { width: 100%; }
</style></head><body>
<div id="editor" contenteditable="true" data-placeholder="${safePlaceholder}">${initialHtml}</div>
<script>
  (function () {
    var editor = document.getElementById('editor');
    // Posicao do cursor (limite inferior) dentro do editor. O WebView nao rola
    // sozinho (a altura acompanha o conteudo), entao a tela do app usa isto para
    // rolar a nota e manter a linha sendo escrita acima do teclado.
    function caretBottom() {
      try {
        var sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return null;
        var range = sel.getRangeAt(0).cloneRange();
        range.collapse(false);
        var node = range.startContainer;
        var el = node && node.nodeType === 1 ? node : node && node.parentNode;
        if (!el || !editor.contains(el)) return null;
        var rect = range.getBoundingClientRect();
        if (rect && rect.height) return Math.round(rect.bottom);
        var prect = el.getBoundingClientRect();
        return Math.round(prect.top + prect.height);
      } catch (e) {
        return null;
      }
    }
    function send() {
      var height = Math.max(160, document.body.scrollHeight);
      window.ReactNativeWebView.postMessage(JSON.stringify({ html: editor.innerHTML, height: height, caret: caretBottom() }));
    }
    function wrapImages() {
      var imgs = editor.querySelectorAll('img');
      for (var i = 0; i < imgs.length; i++) {
        var img = imgs[i];
        var parent = img.parentNode;
        if (parent && parent.classList && parent.classList.contains('img-block')) continue;
        var block = document.createElement('div');
        block.className = 'img-block';
        block.setAttribute('contenteditable', 'false');
        parent.insertBefore(block, img);
        block.appendChild(img);
      }
      ensureLeading();
      ensureTrailing();
    }
    function ensureParagraphAfter(block) {
      var next = block.nextSibling;
      if (!next || next.nodeType !== 1) {
        var p = document.createElement('div');
        p.innerHTML = '<br>';
        editor.insertBefore(p, block.nextSibling);
        return p;
      }
      return next;
    }
    // Sempre existe um paragrafo editavel depois da ultima imagem: da pra digitar.
    function ensureTrailing() {
      var last = editor.lastElementChild;
      if (last && last.classList && last.classList.contains('img-block')) {
        var p = document.createElement('div');
        p.innerHTML = '<br>';
        editor.appendChild(p);
      }
    }
    // E um paragrafo antes da primeira imagem (digitar acima).
    function ensureLeading() {
      var first = editor.firstElementChild;
      if (first && first.classList && first.classList.contains('img-block')) {
        var p = document.createElement('div');
        p.innerHTML = '<br>';
        editor.insertBefore(p, first);
      }
    }
    function placeCaret(node) {
      var range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(true);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    editor.addEventListener('input', send);
    editor.addEventListener('focus', function () {
      window.ReactNativeWebView.postMessage(JSON.stringify({ editing: true }));
      send();
    });
    // Toque longo numa imagem abre o menu dela (largura/apagar). O toque curto
    // abre a foto maior. O flag e zerado a cada novo toque e consumido no click.
    var longPressTimer = null;
    var longPressFired = false;
    function cancelLongPress() {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    }
    function imageFromNode(node) {
      while (node && node !== editor) {
        if (node.tagName === 'IMG') return node;
        node = node.parentNode;
      }
      return null;
    }
    editor.addEventListener('touchstart', function (e) {
      longPressFired = false;
      var img = imageFromNode(e.target);
      if (!img) { cancelLongPress(); return; }
      cancelLongPress();
      longPressTimer = setTimeout(function () {
        longPressTimer = null;
        longPressFired = true;
        var width = parseInt(img.getAttribute('data-width') || '', 10);
        window.ReactNativeWebView.postMessage(JSON.stringify({
          imageMenu: { src: img.getAttribute('src') || '', width: isNaN(width) ? 100 : width }
        }));
      }, 450);
    }, { passive: true });
    editor.addEventListener('touchmove', cancelLongPress, { passive: true });
    editor.addEventListener('touchend', cancelLongPress);
    editor.addEventListener('touchcancel', cancelLongPress);
    // Sem o menu nativo do navegador ao segurar a imagem.
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    // Bloco opaco (tabela, divisoria): somente leitura. Toque pede para apagar
    // (o app confirma); nao entra para o cursor e nao sai do lugar.
    editor.addEventListener('click', function (e) {
      var node = e.target;
      while (node && node !== editor) {
        if (node.classList && node.classList.contains('opaque-block')) {
          e.preventDefault();
          var label = node.getAttribute('data-label') || 'bloco';
          window.ReactNativeWebView.postMessage(JSON.stringify({
            opaqueMenu: { label: label, markdown: node.getAttribute('data-md') || '' }
          }));
          return;
        }
        node = node.parentNode;
      }
    }, true);
    editor.addEventListener('click', function (e) {
      var node = e.target;
      while (node && node !== editor) {
        if (node.tagName === 'A' && node.getAttribute('href')) {
          e.preventDefault();
          window.ReactNativeWebView.postMessage(JSON.stringify({ open: node.getAttribute('href') }));
          return;
        }
        node = node.parentNode;
      }
      // Tocar numa imagem abre a foto maior; o toque longo ja abriu o menu.
      var block = e.target;
      while (block && block !== editor) {
        if (block.classList && block.classList.contains('img-block')) {
          e.preventDefault();
          if (longPressFired) { longPressFired = false; return; }
          var img = block.querySelector('img');
          if (img) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ imageOpen: img.getAttribute('src') || '' }));
          }
          return;
        }
        block = block.parentNode;
      }
      // Tocar na nota abre o menu de acoes (formatar, foto, audio).
      window.ReactNativeWebView.postMessage(JSON.stringify({ editing: true }));
      // Tocar na area vazia do editor tambem abre o cursor.
      if (e.target === editor) {
        var last = editor.lastElementChild;
        if (last && last.classList && last.classList.contains('img-block')) {
          last = ensureTrailing();
        }
        if (!last) {
          last = document.createElement('div');
          last.innerHTML = '<br>';
          editor.appendChild(last);
        }
        placeCaret(last);
        editor.focus();
      }
    });
    window.addEventListener('load', function () { wrapImages(); ensureTrailing(); send(); });
    if (window.ResizeObserver) {
      try { new ResizeObserver(function () { send(); }).observe(editor); } catch (e) {}
    }
    document.addEventListener('load', function (e) {
      if (e.target && e.target.tagName === 'IMG') { send(); }
    }, true);
    window.__exec = function (cmd) { editor.focus(); document.execCommand(cmd, false, null); send(); };
    window.__focus = function () { editor.focus(); };
    // Insere a imagem como bloco e deixa um paragrafo (com cursor) logo abaixo.
    window.__insertImage = function (src, persistSrc, alt) {
      editor.focus();
      var block = document.createElement('div');
      block.className = 'img-block';
      block.setAttribute('contenteditable', 'false');
      var img = document.createElement('img');
      img.src = src;
      img.alt = alt || '';
      if (persistSrc) { img.setAttribute('data-src', persistSrc); }
      block.appendChild(img);
      var inserted = false;
      var sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        var host = sel.getRangeAt(0).startContainer;
        host = host.nodeType === 1 ? host : host.parentNode;
        while (host && host.parentNode !== editor) { host = host.parentNode; }
        if (host && host.parentNode === editor) {
          editor.insertBefore(block, host.nextSibling);
          inserted = true;
        }
      }
      if (!inserted) { editor.appendChild(block); }
      ensureLeading();
      var after = ensureParagraphAfter(block);
      placeCaret(after);
      send();
    };
    // Acha a imagem pela referencia salva (data-src) ou pela fonte exibida.
    function findImage(key) {
      var imgs = editor.querySelectorAll('img');
      for (var i = 0; i < imgs.length; i++) {
        var img = imgs[i];
        if ((img.getAttribute('data-src') || '') === key || (img.getAttribute('src') || '') === key) {
          return img;
        }
      }
      return null;
    }
    // Muda a largura de uma imagem existente (percentual da largura da nota).
    window.__setImageWidth = function (key, width) {
      var img = findImage(key);
      if (!img) return;
      var pct = Math.max(15, Math.min(100, Math.round(width)));
      if (pct >= 100) {
        // Limpa todas as larguras (o atributo "width" do round-trip ficava preso
        // e a imagem nao voltava para a largura total).
        img.removeAttribute('data-width');
        img.removeAttribute('width');
        img.style.width = '';
      } else {
        img.setAttribute('data-width', String(pct));
        img.setAttribute('width', pct + '%');
        img.style.width = pct + '%';
      }
      send();
    };
    // Apaga a imagem (o bloco todo), mantendo um paragrafo util depois.
    window.__deleteImage = function (key) {
      var img = findImage(key);
      if (!img) return;
      var block = img.parentNode;
      if (block && block.classList && block.classList.contains('img-block')) {
        block.parentNode.removeChild(block);
      } else {
        img.parentNode.removeChild(img);
      }
      ensureTrailing();
      send();
    };
    // Apaga o bloco opaco pelo markdown que ele carrega (so depois da
    // confirmacao do usuario, do lado do app).
    window.__deleteOpaque = function (markdown) {
      var blocks = editor.querySelectorAll('.opaque-block');
      for (var i = 0; i < blocks.length; i++) {
        if ((blocks[i].getAttribute('data-md') || '') === markdown) {
          blocks[i].parentNode.removeChild(blocks[i]);
          ensureTrailing();
          send();
          return true;
        }
      }
      return false;
    };
    // Insere um link no cursor (rotulo = texto; sem rotulo, usa a propria URL).
    window.__insertLink = function (url, label) {
      editor.focus();
      var a = document.createElement('a');
      a.setAttribute('href', url);
      a.textContent = (label && label !== '') ? label : url;
      var sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) {
        var p = document.createElement('div');
        p.appendChild(a);
        editor.appendChild(p);
      } else {
        var range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(a);
        range.setStartAfter(a);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      send();
    };
  })();
</script></body></html>`;
}

const RichEditorInner = forwardRef<RichEditorHandle, RichEditorProps>(function RichEditor(
  {
    value,
    onChangeMarkdown,
    onEditingChange,
    onReady,
    onCaret,
    onImageOpen,
    onImageMenu,
    placeholder = '',
    imageSources,
    baseUrl,
    typography = DEFAULT_TYPOGRAPHY,
    minHeight = 160,
    measure = DEFAULT_MEASURE,
    onOpaqueMenu,
  },
  ref,
) {
  const webRef = useRef<{ injectJavaScript: (code: string) => void } | null>(null);
  useRenderCount('RichEditor');
  const plainRef = useRef<TextInput>(null);
  const lastValue = useRef(value);
  const [height, setHeight] = useState(200);
  const [plain, setPlain] = useState(value);
  const plainSelection = useRef({ start: 0, end: 0 });

  // O HTML inicial e construido uma unica vez; reconstrui-lo a cada render
  // pesava e ainda recarregava o WebView (source com objeto novo).
  const htmlSourceRef = useRef<string | null>(null);
  if (htmlSourceRef.current === null) {
    htmlSourceRef.current = buildEditorHtml(
      placeholder,
      markdownToHtml(value, imageSources),
      typography,
      measure,
    );
  }
  const source = useMemo(
    () => ({ html: htmlSourceRef.current as string, baseUrl }),
    [baseUrl],
  );
  const sizeStyle = useMemo(() => ({ height: Math.max(height, minHeight) }), [height, minHeight]);

  // Mantem o callback atual sem recriar o handler do WebView a cada render.
  const onChangeRef = useRef(onChangeMarkdown);
  useEffect(() => {
    onChangeRef.current = onChangeMarkdown;
  }, [onChangeMarkdown]);

  const onEditingRef = useRef(onEditingChange);
  useEffect(() => {
    onEditingRef.current = onEditingChange;
  }, [onEditingChange]);

  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  const onCaretRef = useRef(onCaret);
  useEffect(() => {
    onCaretRef.current = onCaret;
  }, [onCaret]);

  const onImageOpenRef = useRef(onImageOpen);
  useEffect(() => {
    onImageOpenRef.current = onImageOpen;
  }, [onImageOpen]);

  const onImageMenuRef = useRef(onImageMenu);
  useEffect(() => {
    onImageMenuRef.current = onImageMenu;
  }, [onImageMenu]);

  const onOpaqueMenuRef = useRef(onOpaqueMenu);
  useEffect(() => {
    onOpaqueMenuRef.current = onOpaqueMenu;
  }, [onOpaqueMenu]);

  // Aplica mudancas de tipografia sem recarregar o WebView.
  useEffect(() => {
    if (!WebViewModule || !webRef.current) return;
    const css =
      `document.body.style.fontFamily=${JSON.stringify(fontFamilyCss(typography.family))};` +
      `document.body.style.fontSize=${JSON.stringify(`${typography.size}px`)};` +
      `document.body.style.fontWeight=${JSON.stringify(String(fontWeightCss(typography.weight)))};true;`;
    webRef.current.injectJavaScript(css);
  }, [typography]);

  const handleMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as {
        html?: string;
        height?: number;
        caret?: number;
        open?: string;
        editing?: boolean;
        imageOpen?: string;
        imageMenu?: { src?: string; width?: number };
        opaqueMenu?: { label?: string; markdown?: string };
      };
      if (data.editing === true) {
        onEditingRef.current?.(true);
        return;
      }
      if (typeof data.open === 'string') {
        void Linking.openURL(data.open).catch(() => undefined);
        return;
      }
      if (typeof data.imageOpen === 'string') {
        onImageOpenRef.current?.(data.imageOpen);
        return;
      }
      if (data.imageMenu && typeof data.imageMenu.src === 'string') {
        onImageMenuRef.current?.(data.imageMenu.src, data.imageMenu.width ?? 100);
        return;
      }
      if (data.opaqueMenu && typeof data.opaqueMenu.markdown === 'string') {
        onOpaqueMenuRef.current?.({
          label: data.opaqueMenu.label ?? 'bloco',
          markdown: data.opaqueMenu.markdown,
        });
        return;
      }
      if (typeof data.height === 'number') {
        setHeight(Math.min(Math.max(data.height, 160), 4000));
      }
      if (typeof data.caret === 'number') {
        onCaretRef.current?.(data.caret);
      }
      const markdown = htmlToMarkdown(String(data.html ?? ''));
      if (markdown !== lastValue.current) {
        lastValue.current = markdown;
        onChangeRef.current(markdown);
      }
    } catch {
      // mensagem inesperada: ignora
    }
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      format(type) {
        if (WebViewModule && webRef.current) {
          const command =
            type === 'bold' ? 'bold' : type === 'italic' ? 'italic' : 'insertUnorderedList';
          webRef.current.injectJavaScript(`window.__exec('${command}'); true;`);
          return;
        }
        const result = applyMarkdownFormat(plain, plainSelection.current, type);
        setPlain(result.text);
        plainSelection.current = result.selection;
        lastValue.current = result.text;
        onChangeMarkdown(result.text);
      },
      focus() {
        if (WebViewModule && webRef.current) {
          webRef.current.injectJavaScript('window.__focus(); true;');
          return;
        }
        plainRef.current?.focus();
      },
      insertImage(displaySrc, persistSrc, alt) {
        if (WebViewModule && webRef.current) {
          webRef.current.injectJavaScript(
            `window.__insertImage(${JSON.stringify(displaySrc)}, ${JSON.stringify(persistSrc)}, ${JSON.stringify(alt)}); true;`,
          );
          return;
        }
        const next = `${plain}${plain ? '\n' : ''}![${alt}](${persistSrc})`;
        setPlain(next);
        lastValue.current = next;
        onChangeMarkdown(next);
      },
      setImageWidth(key, widthPercent) {
        if (WebViewModule && webRef.current) {
          webRef.current.injectJavaScript(
            `window.__setImageWidth(${JSON.stringify(key)}, ${JSON.stringify(widthPercent)}); true;`,
          );
          return;
        }
        const next = setImageWidthInMarkdown(plain, key, widthPercent);
        setPlain(next);
        lastValue.current = next;
        onChangeMarkdown(next);
      },
      deleteImage(key) {
        if (WebViewModule && webRef.current) {
          webRef.current.injectJavaScript(`window.__deleteImage(${JSON.stringify(key)}); true;`);
          return;
        }
        const next = removeImageFromMarkdown(plain, key);
        setPlain(next);
        lastValue.current = next;
        onChangeMarkdown(next);
      },
      deleteOpaque(markdown) {
        if (WebViewModule && webRef.current) {
          webRef.current.injectJavaScript(
            `window.__deleteOpaque(${JSON.stringify(markdown)}); true;`,
          );
          return;
        }
        // Sem WebView nao ha bloco opaco na tela: remove do markdown.
        const next = plain.replace(`${markdown}\n`, '').replace(markdown, '');
        setPlain(next);
        lastValue.current = next;
        onChangeMarkdown(next);
      },
      insertLink(url, label) {
        if (WebViewModule && webRef.current) {
          webRef.current.injectJavaScript(
            `window.__insertLink(${JSON.stringify(url)}, ${JSON.stringify(label ?? '')}); true;`,
          );
          return;
        }
        const next = `${plain}${plain ? '\n' : ''}[${label ?? url}](${url})`;
        setPlain(next);
        lastValue.current = next;
        onChangeMarkdown(next);
      },
    }),
    [plain, onChangeMarkdown],
  );

  if (!WebViewModule) {
    return (
      <TextInput
        ref={plainRef}
        value={plain}
        onChangeText={(next) => {
          setPlain(next);
          lastValue.current = next;
          onChangeMarkdown(next);
        }}
        onSelectionChange={(event) => {
          plainSelection.current = event.nativeEvent.selection;
        }}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        selectionColor={colors.accent}
        multiline
        textAlignVertical="top"
        style={styles.plain}
      />
    );
  }

  return (
    <View style={sizeStyle}>
      <WebViewModule.WebView
        ref={webRef}
        originWhitelist={['*']}
        source={source}
        onMessage={handleMessage}
        onLoadEnd={() => onReadyRef.current?.()}
        style={styles.web}
        scrollEnabled={false}
        showsVerticalScrollIndicator={false}
        hideKeyboardAccessoryView
        keyboardDisplayRequiresUserAction={false}
        // Imagem local (`file://`) sem passar por base64. O acesso a arquivos e
        // desligado por padrao no Android 11+; aqui so carregamos o HTML e o
        // markdown que nos mesmos geramos, entao o acesso fica no sandbox do app.
        allowFileAccess
        allowFileAccessFromFileURLs
      />
    </View>
  );
});

// Memoizado: a tela da nota re-renderiza com frequencia (autosave, fila) e o
// WebView nao pode ser recriado a cada render.
export const RichEditor = memo(RichEditorInner);

const styles = StyleSheet.create({
  plain: {
    color: colors.text,
    fontSize: fontSize.lg,
    lineHeight: 24,
    minHeight: 160,
    paddingVertical: spacing.sm,
  },
  // Transparente: a cor da nota vem da tela, nao do WebView (com fundo proprio
  // aqui, a nota aparecia com duas cores).
web: { flex: 1, backgroundColor: 'transparent' },
});
