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
import { InteractionManager, Linking, StyleSheet, TextInput, TurboModuleRegistry, View } from 'react-native';

import {
  applyMarkdownFormat,
  htmlToMarkdown,
  markdownToHtml,
  type FormatType,
} from '@/core/richText';
import { colors, fontSize, spacing } from '@/theme/tokens';

export interface RichEditorHandle {
  format(type: FormatType): void;
  focus(): void;
  /** Insere imagem no cursor: `displaySrc` e a previa; `persistSrc` e a URL salva. */
  insertImage(displaySrc: string, persistSrc: string, alt: string): void;
}

interface RichEditorProps {
  value: string;
  onChangeMarkdown: (markdown: string) => void;
  placeholder?: string;
  /** Mapa URL original -> fonte de exibicao (ex.: data URI) para imagens. */
  imageSources?: Record<string, string>;
}

// O modulo nativo do WebView so existe depois de um novo build. Enquanto nao
// existir, cai para um editor simples (com marcadores) para nao quebrar o app.
const hasWebView = Boolean(TurboModuleRegistry.get('RNCWebViewModule'));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const WebViewModule = hasWebView ? require('react-native-webview') : null;

function buildEditorHtml(placeholder: string, initialHtml: string): string {
  const safePlaceholder = placeholder.replace(/"/g, '&quot;');
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<style>
  html, body { margin: 0; padding: 0; background: #0A0A0F; color: #FFFFFF; font-family: -apple-system, system-ui, sans-serif; font-size: 17px; line-height: 1.5; word-wrap: break-word; }
  #editor { min-height: 160px; padding: 4px 0; outline: none; }
  #editor:empty:before { content: attr(data-placeholder); color: #5A5A5F; }
  ul { padding-left: 22px; margin: 6px 0; }
  div { min-height: 1.5em; }
  a { color: #8B7BE8; text-decoration: underline; }
  .img-block { position: relative; display: block; margin: 6px 0; }
  .img-block img { display: block; max-width: 100%; border-radius: 10px; }
  .img-handle { position: absolute; top: 50%; right: -9px; width: 20px; height: 20px; margin-top: -10px; border-radius: 50%; background: #6E56CF; border: 2px solid #FFFFFF; touch-action: none; }
</style></head><body>
<div id="editor" contenteditable="true" data-placeholder="${safePlaceholder}">${initialHtml}</div>
<script>
  (function () {
    var editor = document.getElementById('editor');
    function send() {
      var height = Math.max(160, document.body.scrollHeight);
      window.ReactNativeWebView.postMessage(JSON.stringify({ html: editor.innerHTML, height: height }));
    }
    function attachHandle(block, img) {
      if (block.querySelector('.img-handle')) return;
      var handle = document.createElement('span');
      handle.className = 'img-handle';
      handle.setAttribute('contenteditable', 'false');
      block.appendChild(handle);
      var startX = 0, startW = 0, maxW = 1;
      function onMove(e) {
        e.preventDefault();
        var t = e.touches[0];
        var w = Math.max(60, Math.min(maxW, startW + (t.clientX - startX)));
        img.style.width = Math.round((w / maxW) * 100) + '%';
      }
      function onEnd() {
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);
        var pct = Math.round((img.getBoundingClientRect().width / maxW) * 100);
        img.setAttribute('data-width', String(pct));
        img.style.width = pct + '%';
        send();
      }
      handle.addEventListener('touchstart', function (e) {
        e.preventDefault();
        var t = e.touches[0];
        startX = t.clientX;
        startW = img.getBoundingClientRect().width;
        maxW = editor.getBoundingClientRect().width || 1;
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onEnd);
      });
    }
    function wrapImages() {
      var imgs = editor.querySelectorAll('img');
      for (var i = 0; i < imgs.length; i++) {
        var img = imgs[i];
        var parent = img.parentNode;
        if (parent && parent.classList && parent.classList.contains('img-block')) {
          attachHandle(parent, img);
          continue;
        }
        var block = document.createElement('div');
        block.className = 'img-block';
        block.setAttribute('contenteditable', 'false');
        parent.insertBefore(block, img);
        block.appendChild(img);
        attachHandle(block, img);
      }
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
    function placeCaret(node) {
      var range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(true);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    editor.addEventListener('input', send);
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
    });
    window.addEventListener('load', function () { wrapImages(); send(); });
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
      var after = ensureParagraphAfter(block);
      attachHandle(block, img);
      placeCaret(after);
      send();
    };
  })();
</script></body></html>`;
}

const RichEditorInner = forwardRef<RichEditorHandle, RichEditorProps>(function RichEditor(
  { value, onChangeMarkdown, placeholder = '', imageSources },
  ref,
) {
  const webRef = useRef<{ injectJavaScript: (code: string) => void } | null>(null);
  const plainRef = useRef<TextInput>(null);
  const lastValue = useRef(value);
  const [height, setHeight] = useState(200);
  const [plain, setPlain] = useState(value);
  const plainSelection = useRef({ start: 0, end: 0 });
  const [ready, setReady] = useState(!WebViewModule);

  // O HTML inicial e construido uma unica vez; reconstrui-lo a cada render
  // pesava e ainda recarregava o WebView (source com objeto novo).
  const htmlSourceRef = useRef<string | null>(null);
  if (htmlSourceRef.current === null) {
    htmlSourceRef.current = buildEditorHtml(placeholder, markdownToHtml(value, imageSources));
  }
  const source = useMemo(() => ({ html: htmlSourceRef.current as string }), []);
  const sizeStyle = useMemo(() => ({ height }), [height]);

  // Mantem o callback atual sem recriar o handler do WebView a cada render.
  const onChangeRef = useRef(onChangeMarkdown);
  useEffect(() => {
    onChangeRef.current = onChangeMarkdown;
  }, [onChangeMarkdown]);

  // Monta o WebView so depois da transicao de tela: criar o WebView durante a
  // animacao derruba os frames.
  useEffect(() => {
    if (!WebViewModule || ready) return undefined;
    const task = InteractionManager.runAfterInteractions(() => setReady(true));
    return () => task.cancel();
  }, [ready]);

  const handleMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as {
        html?: string;
        height?: number;
        open?: string;
      };
      if (typeof data.open === 'string') {
        void Linking.openURL(data.open).catch(() => undefined);
        return;
      }
      if (typeof data.height === 'number') {
        setHeight(Math.min(Math.max(data.height, 160), 4000));
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
      {ready ? (
        <WebViewModule.WebView
          ref={webRef}
          originWhitelist={['*']}
          source={source}
          onMessage={handleMessage}
          style={styles.web}
          scrollEnabled={false}
          showsVerticalScrollIndicator={false}
          hideKeyboardAccessoryView
          keyboardDisplayRequiresUserAction={false}
        />
      ) : (
        <View style={styles.web} />
      )}
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
  web: { flex: 1, backgroundColor: '#0A0A0F' },
});
