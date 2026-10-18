/**
 * Leitor nativo da nota (markdown).
 *
 * Abrir a nota NAO monta WebView: o corpo vira Text/Image nativos e le a fonte
 * das preferencias na hora. O editor so aparece quando o usuario toca para
 * editar (ver MarkdownComposer/RichEditor na tela da nota).
 */

import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  type DimensionValue,
  type GestureResponderEvent,
} from 'react-native';

import {
  parseMarkdownView,
  type InlineSpan,
  type MarkdownBlock,
} from '@/core/markdownView';
import {
  fontFamilyNative,
  fontWeightNative,
  type NoteTypography,
} from '@/core/typography';
import { colors, radius, spacing } from '@/theme/tokens';

interface NoteReaderProps {
  markdown: string;
  imageSources: Record<string, string>;
  typography: NoteTypography;
  minHeight: number;
  placeholder: string;
  onStartEditing: () => void;
  onImageOpen: (uri: string) => void;
  onImageMenu: (ref: string, width: number) => void;
}

/** Proporcao ja conhecida de cada imagem local (evita medir de novo). */
const ratios = new Map<string, number>();

function ReaderImage({
  uri,
  width,
  alt,
  onOpen,
  onMenu,
}: {
  uri: string;
  width?: number;
  alt: string;
  onOpen: (uri: string) => void;
  onMenu: () => void;
}) {
  const [ratio, setRatio] = useState(ratios.get(uri) ?? 4 / 3);
  useEffect(() => {
    if (ratios.has(uri)) {
      return undefined;
    }
    let alive = true;
    Image.getSize(
      uri,
      (widthPx, heightPx) => {
        if (!alive || widthPx <= 0 || heightPx <= 0) return;
        const value = widthPx / heightPx;
        ratios.set(uri, value);
        setRatio(value);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [uri]);

  const widthValue = (width ? `${width}%` : '100%') as DimensionValue;
  return (
    <Pressable
      onPress={(event) => {
        event.stopPropagation();
        onOpen(uri);
      }}
      onLongPress={(event) => {
        event.stopPropagation();
        onMenu();
      }}
      delayLongPress={450}
      accessibilityLabel={alt || 'Foto da nota'}
      style={[styles.image, { width: widthValue, aspectRatio: ratio }]}
    >
      <Image source={{ uri }} style={styles.imageFill} resizeMode="contain" fadeDuration={0} />
    </Pressable>
  );
}

function Inline({
  spans,
  style,
  boldWeight = '700',
}: {
  spans: InlineSpan[];
  style: object;
  boldWeight?: '700' | '800' | '900';
}) {
  return (
    <Text style={style}>
      {spans.map((span, index) => (
        <Text
          key={index}
          style={[
            span.bold ? { fontWeight: boldWeight } : null,
            span.italic ? styles.italic : null,
            span.code ? styles.code : null,
            span.link || span.note ? styles.link : null,
          ]}
          onPress={
            span.link || span.note
              ? (event: GestureResponderEvent) => {
                  event.stopPropagation();
                  if (span.note) {
                    router.push({ pathname: '/note/[id]', params: { id: span.note } });
                  } else if (span.link) {
                    void Linking.openURL(span.link).catch(() => undefined);
                  }
                }
              : undefined
          }
        >
          {span.text}
        </Text>
      ))}
    </Text>
  );
}

export function NoteReader({
  markdown,
  imageSources,
  typography,
  minHeight,
  placeholder,
  onStartEditing,
  onImageOpen,
  onImageMenu,
}: NoteReaderProps) {
  const blocks = useMemo(() => parseMarkdownView(markdown), [markdown]);
  const base = useMemo(
    () => ({
      color: colors.text,
      fontFamily: fontFamilyNative(typography.family),
      fontSize: typography.size,
      fontWeight: fontWeightNative(typography.weight),
      lineHeight: Math.round(typography.size * 1.5),
    }),
    [typography],
  );
  // Se a nota ja usa peso 700 no texto normal, o negrito precisa ser mais forte
  // para continuar visivel.
  const boldWeight: '700' | '900' = typography.weight === 'bold' ? '900' : '700';

  const renderBlock = (block: MarkdownBlock, index: number) => {
    switch (block.type) {
      case 'image': {
        const uri = imageSources[block.ref];
        return uri ? (
          <ReaderImage
            key={index}
            uri={uri}
            width={block.width}
            alt={block.alt}
            onOpen={onImageOpen}
            onMenu={() => onImageMenu(block.ref, block.width ?? 100)}
          />
        ) : (
          <View
            key={index}
            style={[
              styles.imagePlaceholder,
              { width: (block.width ? `${block.width}%` : '100%') as DimensionValue },
            ]}
          >
            <ActivityIndicator size="small" color={colors.textTertiary} />
          </View>
        );
      }
      case 'heading': {
        const size =
          typography.size *
          (block.level === 1 ? 1.6 : block.level === 2 ? 1.35 : block.level === 3 ? 1.15 : 1);
        return (
          <Inline
            key={index}
            spans={block.spans}
            boldWeight={boldWeight}
            style={[
              base,
              styles.heading,
              { fontSize: Math.round(size), lineHeight: Math.round(size * 1.3) },
            ]}
          />
        );
      }
      case 'quote':
        return (
          <View key={index} style={styles.quote}>
            <Inline spans={block.spans} boldWeight={boldWeight} style={[base, styles.quoteText]} />
          </View>
        );
      case 'list':
        return (
          <View key={index} style={styles.listRow}>
            <Text style={[base, styles.listMarker]}>{block.marker}</Text>
            <Inline spans={block.spans} boldWeight={boldWeight} style={[base, styles.listText]} />
          </View>
        );
      case 'code':
        return (
          <View key={index} style={styles.codeBlock}>
            <Text style={styles.codeText}>{block.text}</Text>
          </View>
        );
      case 'table':
        return (
          <View key={index} style={styles.codeBlock}>
            <Text style={styles.codeText}>{block.text}</Text>
          </View>
        );
      case 'divider':
        return <View key={index} style={styles.divider} />;
      default:
        return (
          <Inline
            key={index}
            spans={block.spans}
            boldWeight={boldWeight}
            style={[base, styles.paragraph]}
          />
        );
    }
  };

  return (
    <Pressable
      onPress={onStartEditing}
      style={[styles.root, { minHeight }]}
      accessibilityLabel="Editar nota"
      accessibilityHint="Abre o editor"
    >
      {blocks.length === 0 ? (
        <Text style={[base, styles.placeholder]}>{placeholder}</Text>
      ) : (
        blocks.map(renderBlock)
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { paddingVertical: spacing.xs },
  paragraph: { marginBottom: spacing.sm },
  heading: { fontWeight: '700', marginTop: spacing.md, marginBottom: spacing.xs },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  code: {
    fontFamily: 'monospace',
    backgroundColor: colors.surface,
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  link: { color: colors.accentStrong, textDecorationLine: 'underline' },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: colors.borderStrong,
    paddingLeft: spacing.sm,
    marginBottom: spacing.sm,
  },
  quoteText: { color: colors.textSecondary },
  listRow: { flexDirection: 'row', marginBottom: spacing.xs },
  listMarker: { color: colors.textSecondary, minWidth: 20 },
  listText: { flex: 1 },
  codeBlock: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginVertical: spacing.sm,
  },
  codeText: {
    color: colors.textSecondary,
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 19,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderStrong,
    marginVertical: spacing.md,
  },
  image: {
    alignSelf: 'center',
    borderRadius: radius.md,
    marginVertical: spacing.sm,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  imageFill: { width: '100%', height: '100%' },
  imagePlaceholder: {
    alignSelf: 'center',
    height: 120,
    borderRadius: radius.md,
    marginVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  placeholder: { color: colors.textTertiary },
});

export default NoteReader;
