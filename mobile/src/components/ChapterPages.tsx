import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  View,
  type ListRenderItem,
  type TextStyle,
} from 'react-native';

import { markdownToPlain } from '@/core/richText';
import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/ThemeContext';
import { bookBodyFamily, pageCount, pageWindow, type BookPage } from '../core/books';

export type ChapterPagesProps = {
  markdown: string;
  page: BookPage;
  width: number;
  onPageCount: (pages: number) => void;
  totalHeightOverride?: number;
  ListHeaderComponent?: React.ComponentType<any> | React.ReactElement | null;
};

const GAP = 16;
const GAP_LINE_HEIGHT = 14;

const SHEET_BORDER_RADIUS = 2;

/** Cores do papel e da tinta usadas no web, independentes do tema do app. */
const BOOK_COLORS: Record<
  'light' | 'dark',
  { paper: string; ink: string }
> = {
  light: { paper: '#fbf9f4', ink: '#2a2621' },
  dark: { paper: '#1a1d22', ink: '#e4e8e3' },
};

function bookColors(isLight: boolean) {
  return isLight ? BOOK_COLORS.light : BOOK_COLORS.dark;
}

/**
 * Decide se o corpo pode ser paginado. Midia e estrutura (titulo, imagem,
 * audio, anexo) voltam ao editor comum.
 */
export function isChapterPaginable(markdown: string): boolean {
  const trimmed = markdown.trim();
  if (!trimmed) return false;
  const lines = trimmed.split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) return false;
    if (line.startsWith('!')) return false;
    if (line.startsWith('attachment:')) return false;
    // Imagens, audios e links de anexo em qualquer lugar do corpo.
    if (line.includes('!audio[') || line.includes('![') || line.includes('(attachment:')) {
      return false;
    }
  }
  return true;
}

function splitParagraphs(markdown: string): string[] {
  const plain = markdownToPlain(markdown).trim();
  if (!plain) return [];
  return plain
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * RN nao tem `text-indent`; o espaco eme (\u2003) e uma aproximacao do
 * recuo de 1,4 em usado no web.
 */
function pageText(paragraphs: string[]): string {
  return paragraphs.map((p, i) => (i > 0 ? '\u2003' : '') + p).join('\n');
}

function useDerivedPageGeometry(page: BookPage, width: number) {
  return useMemo(() => {
    const safeWidth = Math.max(1, width);
    const scale = safeWidth / page.widthPx;
    const fontSize = page.bodyPx * scale;
    const lineHeight = page.bodyPx * page.leading * scale;
    const margin = page.marginPx * scale;
    const pageHeight = safeWidth * (page.heightMm / page.widthMm);
    const contentHeight = Math.max(lineHeight, pageHeight - 2 * margin - lineHeight);
    const window = pageWindow(contentHeight, lineHeight);
    return { scale, fontSize, lineHeight, margin, pageHeight, contentHeight, window };
  }, [page, width]);
}

type PageItem = { index: number };

export function ChapterPages({
  markdown,
  page,
  width,
  onPageCount,
  totalHeightOverride,
  ListHeaderComponent,
}: ChapterPagesProps): ReactElement | null {
  const { colors, name } = useTheme();
  const { paper, ink } = bookColors(name === 'light');
  const { fontSize, lineHeight, margin, pageHeight, window } = useDerivedPageGeometry(page, width);

  const paragraphs = useMemo(() => splitParagraphs(markdown), [markdown]);
  const text = useMemo(() => pageText(paragraphs), [paragraphs]);

  // Posicao do topo de cada linha, medida no proprio texto: a quebra usa o
  // mesmo referencial do desenho, sem acumular erro de arredondamento entre
  // linhas (o que cortava a primeira linha da pagina seguinte).
  const [lineStarts, setLineStarts] = useState<number[] | null>(null);
  const measured = totalHeightOverride !== undefined || lineStarts !== null;

  // O avanco real entre linhas vem do texto medido: se for maior que a
  // entrelinha nominal, cabem menos linhas na janela e a quebra tem de usar o
  // numero medido (senao as linhas que sobram somem entre as paginas).
  const lineAdvance =
    lineStarts && lineStarts.length > 1 ? lineStarts[1] - lineStarts[0] : window.lineHeight;
  const linesPerPage = useMemo(() => {
    if (totalHeightOverride !== undefined) return window.linesPerPage;
    return Math.max(1, Math.floor((window.contentHeight + 0.5) / Math.max(1, lineAdvance)));
  }, [totalHeightOverride, lineAdvance, window]);

  const pages = useMemo(() => {
    if (totalHeightOverride !== undefined) return pageCount(totalHeightOverride, window);
    if (!lineStarts || lineStarts.length === 0) return 1;
    return Math.max(1, Math.ceil(lineStarts.length / linesPerPage));
  }, [linesPerPage, totalHeightOverride, lineStarts, window]);

  useEffect(() => {
    if (measured) onPageCount(pages);
  }, [measured, pages, onPageCount]);

  // Resetar a medida quando o texto, a largura ou a fonte mudam: sem isso a
  // contagem de paginas ficaria presa a uma altura obsoleta.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLineStarts(null);
  }, [markdown, width, page]);

  const bodyStyle: TextStyle = useMemo(
    () => ({
      fontFamily: bookBodyFamily(),
      fontSize,
      lineHeight,
      color: ink,
      textAlign: 'justify',
    }),
    [fontSize, lineHeight, ink],
  );

  const renderPage: ListRenderItem<PageItem> = useCallback(
    ({ item }) => {
      const start = lineStarts
        ? lineStarts[Math.min(item.index * linesPerPage, lineStarts.length - 1)]
        : item.index * window.pageTextHeight;
      const shift = start ?? 0;
      return (
        <View
          testID={`page-card-${item.index}`}
          accessibilityLabel={`Página ${item.index + 1} de ${pages}`}
          style={[
            styles.sheet,
            {
              width,
              height: pageHeight,
              backgroundColor: paper,
              borderColor: colors.border,
            },
          ]}
        >
          <View
            style={[
              styles.window,
              {
                top: margin,
                left: margin,
                right: margin,
                height: linesPerPage * lineAdvance,
              },
            ]}
          >
            <View style={{ marginTop: -shift }}>
              <Text style={[styles.body, bodyStyle]}>{text}</Text>
            </View>
          </View>
          <Text
            style={[
              styles.footer,
              {
                color: colors.textTertiary,
                right: margin,
                bottom: margin - lineHeight * 0.5,
              },
            ]}
          >
            {item.index + 1}
          </Text>
        </View>
      );
    },
    [bodyStyle, colors.border, colors.textTertiary, lineAdvance, lineHeight, lineStarts, linesPerPage, margin, pageHeight, pages, paper, text, width, window.pageTextHeight],
  );

  const separator = useCallback(
    () => (
      <View
        style={[
          styles.gap,
          {
            width,
            height: GAP,
            backgroundColor: colors.bg,
          },
        ]}
      >
        <View
          style={[
            styles.gapLine,
            {
              height: GAP_LINE_HEIGHT,
              borderTopColor: colors.border,
              borderBottomColor: colors.border,
            },
          ]}
        />
      </View>
    ),
    [colors.bg, colors.border, width],
  );

  const data = useMemo<PageItem[]>(() => {
    const items: PageItem[] = [];
    for (let i = 0; i < pages; i++) items.push({ index: i });
    return items;
  }, [pages]);

  // Corpo medido fora da tela, na mesma largura util da folha: a altura total
  // dividida pela altura da linha da o numero de linhas que a janela pagina.
  const contentWidth = Math.max(1, width - margin * 2);
  const measurer =
    totalHeightOverride === undefined ? (
      <View
        pointerEvents="none"
        style={styles.measureHost}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Text
          style={[styles.body, bodyStyle, { width: contentWidth }]}
          onTextLayout={(event) => {
            const lines = event.nativeEvent.lines;
            const next = lines.map((line) => line.y);
            const changed =
              !lineStarts ||
              next.length !== lineStarts.length ||
              next.some((value, index) => Math.abs(value - lineStarts[index]) > 0.5);
            if (next.length > 0 && changed) setLineStarts(next);
          }}
        >
          {text}
        </Text>
      </View>
    ) : null;

  if (!isChapterPaginable(markdown)) return null;

  if (!measured) {
    return (
      <View style={styles.list}>
        {measurer}
        {ListHeaderComponent ? (
          typeof ListHeaderComponent === 'function' ? (
            <ListHeaderComponent />
          ) : (
            ListHeaderComponent
          )
        ) : null}
        <View
          style={[
            styles.sheet,
            {
              width,
              height: pageHeight,
              backgroundColor: paper,
              borderColor: colors.border,
            },
          ]}
        >
          <View
            style={[
              styles.window,
              {
                top: margin,
                left: margin,
                right: margin,
                height: linesPerPage * lineAdvance,
                gap: lineHeight * 0.6,
              },
            ]}
          >
            {Array.from({ length: 12 }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.skeletonLine,
                  {
                    backgroundColor: colors.textTertiary,
                    opacity: 0.12,
                    width: i % 5 === 0 ? '78%' : '100%',
                  },
                ]}
              />
            ))}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {measurer}
      <FlatList
        testID="chapter-pages-list"
        style={styles.list}
        data={data}
        keyExtractor={(item) => String(item.index)}
        renderItem={renderPage}
        ItemSeparatorComponent={separator}
        ListHeaderComponent={ListHeaderComponent}
        contentContainerStyle={[styles.content, { paddingHorizontal: spacing.xl }]}
        showsVerticalScrollIndicator={false}
        windowSize={3}
        initialNumToRender={3}
        maxToRenderPerBatch={3}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  content: { paddingBottom: spacing.xxxl },
  sheet: {
    alignSelf: 'center',
    borderRadius: SHEET_BORDER_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  window: {
    position: 'absolute',
    overflow: 'hidden',
  },
  body: {
    // O estilo tipografico completo vem de `bodyStyle`.
  },
  measureHost: {
    position: 'absolute',
    left: -10000,
    top: 0,
    opacity: 0,
  },
  footer: {
    position: 'absolute',
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 0.6,
  },
  gap: {
    alignSelf: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  gapLine: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  skeletonLine: {
    height: 8,
    borderRadius: 2,
  },
});
