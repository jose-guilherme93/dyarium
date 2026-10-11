import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, TextInput, TurboModuleRegistry, View } from 'react-native';

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
}

interface RichEditorProps {
  value: string;
  onChangeMarkdown: (markdown: string) => void;
  placeholder?: string;
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
  html, body { margin: 0; padding: 0; background: transparent; color: #FFFFFF; font-family: -apple-system, system-ui, sans-serif; font-size: 17px; line-height: 1.5; word-wrap: break-word; }
  #editor { min-height: 160px; padding: 4px 0; outline: none; }
  #editor:empty:before { content: attr(data-placeholder); color: #5A5A5F; }
  ul { padding-left: 22px; margin: 6px 0; }
  div { min-height: 1.5em; }
</style></head><body>
<div id="editor" contenteditable="true" data-placeholder="${safePlaceholder}">${initialHtml}</div>
<script>
  (function () {
    var editor = document.getElementById('editor');
    function send() {
      var height = Math.max(160, document.body.scrollHeight);
      window.ReactNativeWebView.postMessage(JSON.stringify({ html: editor.innerHTML, height: height }));
    }
    editor.addEventListener('input', send);
    window.addEventListener('load', send);
    window.__exec = function (cmd) { editor.focus(); document.execCommand(cmd, false, null); send(); };
    window.__focus = function () { editor.focus(); };
  })();
</script></body></html>`;
}

export const RichEditor = forwardRef<RichEditorHandle, RichEditorProps>(function RichEditor(
  { value, onChangeMarkdown, placeholder = '' },
  ref,
) {
  const webRef = useRef<{ injectJavaScript: (code: string) => void } | null>(null);
  const plainRef = useRef<TextInput>(null);
  const lastValue = useRef(value);
  const [height, setHeight] = useState(200);
  const [plain, setPlain] = useState(value);
  const plainSelection = useRef({ start: 0, end: 0 });
  const htmlSource = useRef(buildEditorHtml(placeholder, markdownToHtml(value))).current;

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
    <View style={{ height }}>
      <WebViewModule.WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html: htmlSource }}
        onMessage={(event: { nativeEvent: { data: string } }) => {
          try {
            const data = JSON.parse(event.nativeEvent.data) as { html?: string; height?: number };
            if (typeof data.height === 'number') {
              setHeight(Math.min(Math.max(data.height, 160), 4000));
            }
            const markdown = htmlToMarkdown(String(data.html ?? ''));
            if (markdown !== lastValue.current) {
              lastValue.current = markdown;
              onChangeMarkdown(markdown);
            }
          } catch {
            // mensagem inesperada: ignora
          }
        }}
        style={styles.web}
        scrollEnabled={false}
        showsVerticalScrollIndicator={false}
        hideKeyboardAccessoryView
        keyboardDisplayRequiresUserAction={false}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  plain: {
    color: colors.text,
    fontSize: fontSize.lg,
    lineHeight: 24,
    minHeight: 160,
    paddingVertical: spacing.sm,
  },
  web: { flex: 1, backgroundColor: 'transparent' },
});
