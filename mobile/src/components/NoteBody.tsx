/**
 * Corpo da nota: texto, foto e audio no mesmo documento, tudo nativo.
 *
 * O texto e um campo de texto do React Native (rapido: e o mesmo campo que o
 * teclado do sistema usa). A formatacao vira marcador no markdown, que o
 * dashboard e a leitura desenham rico. Sem WebView: nada de piscar branco ao
 * sair nem de o cursor puxar a rolagem.
 */

import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type DimensionValue,
  type GestureResponderEvent,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from 'react-native';

import { joinNoteBody, splitNoteBody, type NoteBodyBlock } from '@/core/noteBody';
import {
  applyMarkdownFormat,
  applyMarkdownLink,
  type FormatType,
  type Selection,
} from '@/core/richText';
import { fontFamilyNative, fontWeightNative, type NoteTypography } from '@/core/typography';
import { colors, radius, spacing } from '@/theme/tokens';

export type { FormatType };

export interface NoteBodyHandle {
  /** Foca o bloco em edicao (ou o primeiro). */
  focus(): void;
  /** Aplica formatacao no bloco em edicao, na selecao do cursor. */
  format(type: FormatType): void;
  /** Insere uma foto no corpo: `persistSrc` e a referencia salva no markdown. */
  insertImage(displaySrc: string, persistSrc: string, alt: string, widthPercent?: number): void;
  /** Coloca um link no texto selecionado. */
  insertLink(url: string): void;
  /** Entrega o markdown atual (a edicao ja e enviada a cada tecla). */
  flush(): Promise<void>;
}

interface NoteBodyProps {
  value: string;
  onChangeMarkdown: (markdown: string) => void;
  /** Avisa quando o usuario comeca (ou para) a editar. */
  onEditingChange?: (editing: boolean) => void;
  /** Mapa referencia salva -> fonte de exibicao (arquivo local ou URL). */
  imageSources?: Record<string, string>;
  typography?: NoteTypography;
  /** Toque na foto: abre em tela cheia. */
  onImageOpen?: (src: string) => void;
  placeholder?: string;
}

/** Proporcao ja conhecida de cada imagem local (evita medir de novo). */
const ratios = new Map<string, number>();

/** Identidade de um bloco novo (foto inserida no meio da nota). */
let blockSeq = 0;

function ImageBlock({
  uri,
  width,
  alt,
  onOpen,
  onRemove,
}: {
  uri: string;
  width?: number;
  alt: string;
  onOpen: (uri: string) => void;
  onRemove: () => void;
}) {
  const [ratio, setRatio] = useState(ratios.get(uri) ?? 4 / 3);
  const widthValue = (width ? `${width}%` : '100%') as DimensionValue;
  return (
    <Pressable
      onPress={(event: GestureResponderEvent) => {
        event.stopPropagation();
        onOpen(uri);
      }}
      onLongPress={(event: GestureResponderEvent) => {
        event.stopPropagation();
        onRemove();
      }}
      delayLongPress={450}
      accessibilityLabel={alt || 'Foto da nota'}
      style={[styles.image, { width: widthValue, aspectRatio: ratio }]}
    >
      <Image
        source={{ uri }}
        style={styles.imageFill}
        resizeMode="contain"
        fadeDuration={0}
        // A proporcao vem da propria imagem: sem medir nada antes de desenhar.
        onLoad={(event) => {
          const source = event.nativeEvent.source;
          if (!source?.width || !source?.height) return;
          const value = source.width / source.height;
          ratios.set(uri, value);
          setRatio(value);
        }}
      />
    </Pressable>
  );
}

export const NoteBody = memo(
  forwardRef<NoteBodyHandle, NoteBodyProps>(function NoteBody(
    { value, onChangeMarkdown, onEditingChange, imageSources = {}, typography, onImageOpen, placeholder },
    ref,
  ) {
    const [blocks, setBlocks] = useState<NoteBodyBlock[]>(() => splitNoteBody(value));
    const blocksRef = useRef(blocks);
    const [active, setActive] = useState<string | null>(null);
    const [selection, setSelection] = useState<Selection>({ start: 0, end: 0 });
    const lastEmitted = useRef(value);

    const write = useCallback(
      (next: NoteBodyBlock[]) => {
        blocksRef.current = next;
        setBlocks(next);
        const markdown = joinNoteBody(next);
        lastEmitted.current = markdown;
        onChangeMarkdown(markdown);
      },
      [onChangeMarkdown],
    );

    // Texto vindo de fora (dashboard): re-separa o corpo.
    useEffect(() => {
      if (value === lastEmitted.current) return;
      lastEmitted.current = value;
      const next = splitNoteBody(value);
      blocksRef.current = next;
      setBlocks(next);
    }, [value]);

    const updateText = useCallback(
      (id: string, markdown: string) => {
        const current = blocksRef.current;
        const index = current.findIndex((block) => block.id === id);
        const block = index >= 0 ? current[index] : undefined;
        if (!block || block.kind !== 'text' || block.markdown === markdown) return;
        write(current.map((item, i) => (i === index ? { ...block, markdown } : item)));
      },
      [write],
    );

    const format = useCallback(
      (type: FormatType) => {
        const id = active;
        if (id === null) return;
        const block = blocksRef.current.find((item) => item.id === id);
        if (!block || block.kind !== 'text') return;
        const result = applyMarkdownFormat(block.markdown, selection, type);
        updateText(id, result.text);
        setSelection(result.selection);
      },
      [active, selection, updateText],
    );

    useImperativeHandle(
      ref,
      () => ({
        focus() {
          const first = blocksRef.current.find((block) => block.kind === 'text');
          if (!first) return;
          setActive(first.id);
        },
        format,
        insertImage(_displaySrc, persistSrc, alt, widthPercent = 100) {
          const current = blocksRef.current;
          const at =
            active === null ? current.length : current.findIndex((b) => b.id === active) + 1;
          const image: NoteBodyBlock = {
            kind: 'image',
            id: `b${(blockSeq += 1)}`,
            ref: persistSrc,
            alt,
            width: widthPercent >= 100 ? undefined : widthPercent,
          };
          write([...current.slice(0, at), image, ...current.slice(at)]);
        },
        insertLink(url) {
          const id = active;
          if (id === null) return;
          const block = blocksRef.current.find((item) => item.id === id);
          if (!block || block.kind !== 'text') return;
          const result = applyMarkdownLink(block.markdown, selection, url);
          updateText(id, result.text);
          setSelection(result.selection);
        },
        async flush() {
          const markdown = joinNoteBody(blocksRef.current);
          lastEmitted.current = markdown;
          onChangeMarkdown(markdown);
        },
      }),
      [active, format, onChangeMarkdown, selection, updateText, write],
    );

    const textStyle = useMemo(
      () => ({
        color: colors.text,
        fontFamily: fontFamilyNative(typography?.family ?? 'system'),
        fontSize: typography?.size ?? 17,
        fontWeight: fontWeightNative(typography?.weight ?? 'regular'),
        lineHeight: Math.round((typography?.size ?? 17) * 1.5),
      }),
      [typography],
    );

    return (
      <View style={styles.root}>
        {blocks.map((block) => {
          if (block.kind === 'image') {
            const uri = imageSources[block.ref] ?? block.ref;
            return (
              <ImageBlock
                key={block.id}
                uri={uri}
                width={block.width}
                alt={block.alt}
                onOpen={(src) => onImageOpen?.(src)}
                onRemove={() => write(blocksRef.current.filter((item) => item.id !== block.id))}
              />
            );
          }
          if (block.kind === 'opaque') {
            return (
              <View key={block.id} style={styles.opaque}>
                <Text style={styles.opaqueLabel}>{block.label}</Text>
                <Text style={styles.opaqueText}>{block.markdown}</Text>
              </View>
            );
          }
          return (
            <TextInput
              key={block.id}
              value={block.markdown}
              onChangeText={(text) => updateText(block.id, text)}
              onFocus={() => {
                setActive(block.id);
                onEditingChange?.(true);
              }}
              onBlur={() => onEditingChange?.(false)}
              onSelectionChange={(event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) =>
                setSelection(event.nativeEvent.selection)
              }
              multiline
              scrollEnabled={false}
              placeholder={block.id === blocks[0]?.id ? placeholder : undefined}
              placeholderTextColor={colors.textTertiary}
              selectionColor={colors.accent}
              style={[textStyle, styles.input]}
            />
          );
        })}
      </View>
    );
  }),
);

const styles = StyleSheet.create({
  root: { paddingVertical: spacing.xs },
  input: { padding: 0, marginBottom: spacing.sm, textAlignVertical: 'top' },
  image: {
    alignSelf: 'center',
    borderRadius: radius.md,
    marginVertical: spacing.sm,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  imageFill: { width: '100%', height: '100%' },
  opaque: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginVertical: spacing.sm,
    gap: spacing.xs,
  },
  opaqueLabel: {
    color: colors.textTertiary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  opaqueText: { color: colors.textSecondary, fontFamily: 'monospace', fontSize: 13 },
});
