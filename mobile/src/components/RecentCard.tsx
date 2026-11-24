import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/AppText';
import { Press } from '@/components/Press';
import { formatStamp } from '@/core/format';
import { formatWords } from '@/core/books';
import { push } from '@/services/appNavigation';
import {
  designFont,
  designIcon,
  designRadius,
  designSpace,
} from '@/theme/design';
import { useDesign } from '@/ui/useDesign';
import { typeStyles } from '@/ui/projects/texts';
import type { RecentItemBook, RecentItemProject } from '@/core/recent';

interface RecentCardProps {
  item: RecentItemBook | RecentItemProject;
}

/**
 * Linha de livro ou projeto na lista mista "Recentes" (variante A: glifo a
 * esquerda). Mantem a mesma densidade do cartao denso de nota, mas sem gesto
 * de arrastar e sem menu de acoes.
 */
export const RecentCard = memo(function RecentCard({ item }: RecentCardProps) {
  const colors = useDesign();

  const isBook = item.kind === 'book';
  const title = isBook ? item.notebook.name : item.name;
  const meta = isBook
    ? `${item.chapterCount} capítulos · ${formatWords(item.words)} palavras`
    : `Projetos · ${item.sessions} sessões`;

  const handlePress = () => {
    if (isBook) {
      push({ pathname: '/books/[id]', params: { id: item.notebook.id } });
    } else {
      push({ pathname: '/projects', params: { notebook: item.mcpId } });
    }
  };

  return (
    <View
      style={[styles.wrap, { borderBottomColor: colors.line }]}
      accessibilityLabel={isBook ? `Livro ${title}` : `Projeto ${title}`}
    >
      <Press style={styles.row} onPress={handlePress}>
        <View style={[styles.glyph, { backgroundColor: colors.surfaceRaised }]}>
          <Ionicons
            name={isBook ? 'book-outline' : 'git-branch-outline'}
            size={designIcon.md}
            color={colors.primary}
          />
        </View>

        <View style={styles.body}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {title}
          </Text>

          <View style={styles.metaRow}>
            <Ionicons
              name="document-text-outline"
              size={designIcon.sm}
              color={colors.textMuted}
            />
            <Text style={[styles.meta, { color: colors.textMuted }]} numberOfLines={1}>
              {meta}
            </Text>
          </View>

          <View style={styles.footer}>
            <View style={styles.grow} />
            <Text style={[styles.stamp, { color: colors.textMuted }]}>{formatStamp(item.date)}</Text>
          </View>
        </View>
      </Press>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: 'transparent',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: designSpace.s8,
    paddingHorizontal: designSpace.s16,
    paddingVertical: 10,
  },
  glyph: {
    width: 28,
    height: 28,
    borderRadius: designRadius.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: designSpace.s2,
  },
  title: {
    ...typeStyles.body,
    fontFamily: designFont.semibold,
    fontWeight: '600',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designSpace.s6,
  },
  meta: {
    flex: 1,
    ...typeStyles.mono,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: designSpace.s8,
  },
  grow: { flex: 1 },
  stamp: {
    ...typeStyles.mono,
  },
});
