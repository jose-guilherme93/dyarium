import { Press } from '@/components/Press';
import { Text } from '@/components/AppText';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';
import { baseColors, spacing } from '@/theme/tokens';
import { fontFamilyNative } from '@/core/typography';
import { splitTableRow, tableAlignment } from '@/core/noteHtml';
import { type NoteTableNode } from '@/core/noteDocument';
import { ScrollView, View } from 'react-native';

interface NoteTableProps {
  node: NoteTableNode;
  typography?: { family?: string; size?: number; weight?: string };
  onEditMarkdown?: () => void;
}

type TableAlign = 'left' | 'center' | 'right';

/** Medidor numerico: coluna cujas celulas (do corpo) sao todas numericas. */
function isNumericColumn(cells: string[]): boolean {
  if (cells.length === 0) return false;
  return cells.every((cell) => /^-?[\d\s.,]+$/.test(cell.trim()) && cell.trim() !== '');
}

/** Renderiza o markdown inline simples de uma celula. */
function InlineCellText({
  text,
  style,
  colors,
}: {
  text: string;
  style: object;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|_[^_]+_|\*[^*]+\*)/g);
  return (
    <Text style={style}>
      {tokens.map((token, index) => {
        if (!token) return null;
        if (token.startsWith('**') && token.endsWith('**')) {
          return (
            <Text key={index} style={[style, { fontWeight: '700' }]}>
              {token.slice(2, -2)}
            </Text>
          );
        }
        if (token.startsWith('`') && token.endsWith('`')) {
          return (
            <Text
              key={index}
              style={[
                style,
                {
                  fontFamily: fontFamilyNative('mono'),
                  backgroundColor: colors.surfaceElevated,
                },
              ]}
            >
              {token.slice(1, -1)}
            </Text>
          );
        }
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
        if (link) {
          return (
            <Text key={index} style={[style, { color: colors.accent, textDecorationLine: 'underline' }]}>
              {link[1]}
            </Text>
          );
        }
        if (token.startsWith('_') && token.endsWith('_')) {
          return (
            <Text key={index} style={[style, { fontStyle: 'italic' }]}>
              {token.slice(1, -1)}
            </Text>
          );
        }
        if (token.startsWith('*') && token.endsWith('*')) {
          return (
            <Text key={index} style={[style, { fontStyle: 'italic' }]}>
              {token.slice(1, -1)}
            </Text>
          );
        }
        return <Text key={index}>{token}</Text>;
      })}
    </Text>
  );
}

export function NoteTable({ node, typography, onEditMarkdown }: NoteTableProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  const lines = node.markdown.split('\n');
  const header = splitTableRow(lines[0] ?? '') ?? [];
  const separator = splitTableRow(lines[1] ?? '') ?? [];
  const aligns: TableAlign[] = header.map((_, column) => {
    const alignment = tableAlignment(separator[column] ?? '');
    return (alignment ?? 'left') as TableAlign;
  });
  const bodyRows: string[][] = [];
  for (let index = 2; index < lines.length; index += 1) {
    const row = splitTableRow(lines[index]);
    if (!row || row.length !== header.length) break;
    bodyRows.push(row);
  }

  const numericColumns = header.map((_, column) =>
    isNumericColumn(bodyRows.map((row) => row[column] ?? '')),
  );

  const fontSizeValue = typography?.size ?? 14;
  const fontFamily = typography?.family ? fontFamilyNative(typography.family as 'system') : undefined;

  const cellStyle = (align: TableAlign, numeric: boolean, headerCell: boolean) => [
    styles.cell,
    {
      textAlign: align,
      fontSize: fontSizeValue,
      fontFamily,
      fontWeight: headerCell ? '600' : '400',
      fontVariant: numeric ? (['tabular-nums'] as const) : undefined,
      color: colors.text,
    },
  ];

  return (
    <View style={styles.block} testID="note-table">
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <View style={[styles.row, { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
            {header.map((cell, column) => (
              <View
                key={`h-${column}`}
                style={[styles.cellWrap, { minWidth: 60 }]}
              >
                <InlineCellText
                  text={cell}
                  style={cellStyle(aligns[column], numericColumns[column], true)}
                  colors={colors}
                />
              </View>
            ))}
          </View>
          {bodyRows.map((row, rowIndex) => (
            <View
              key={`r-${rowIndex}`}
              style={[styles.row, styles.bodyRow]}
            >
              {row.map((cell, column) => (
                <View key={`c-${column}`} style={styles.cellWrap}>
                  <InlineCellText
                    text={cell}
                    style={cellStyle(aligns[column], numericColumns[column], false)}
                    colors={colors}
                  />
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
      {onEditMarkdown ? (
        <Press
          style={styles.editButton}
          onPress={onEditMarkdown}
          accessibilityRole="button"
          accessibilityLabel="Editar markdown"
          testID="note-table-edit"
        >
          <Text style={styles.editButtonText}>Editar markdown</Text>
        </Press>
      ) : null}
    </View>
  );
}

const baseStyles = defineStyles({
  block: {
    borderWidth: 1,
    borderColor: baseColors.border,
    borderRadius: 8,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  editButton: {
    alignSelf: 'flex-end',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  editButtonText: {
    fontSize: 12,
    color: baseColors.textSecondary,
  },
  row: {
    flexDirection: 'row',
  },
  bodyRow: {
    borderTopWidth: 1,
    borderTopColor: baseColors.border,
  },
  cellWrap: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minWidth: 60,
  },
  cell: {
    color: baseColors.text,
  },
});