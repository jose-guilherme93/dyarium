import { StyleSheet, Text, View } from 'react-native';

import { designControl, designRadius, designTree } from '@/theme/design';

import { useDesign } from '../useDesign';
import { typeStyles } from './texts';

/**
 * Marca do projeto sem pasta: o icone da entry quando houver (dado do
 * usuario, sincronizado como qualquer campo); sem ele, a letra inicial do
 * nome. Decorativa: quem lê recebe o nome pela linha.
 */
export interface ProjectMarkProps {
  icon?: string;
  project: string;
}

export function ProjectMark({ icon, project }: ProjectMarkProps) {
  const colors = useDesign();
  const glyph = Boolean(icon);
  const text = icon || (project.charAt(0) ? project.charAt(0).toUpperCase() : '?');

  return (
    <View
      accessibilityElementsHidden
      style={[styles.mark, { backgroundColor: colors.surfaceAlt, borderColor: colors.line }]}
    >
      <Text
        style={[
          typeStyles.body,
          {
            color: colors.textMuted,
            fontFamily: glyph ? undefined : typeStyles.title.fontFamily,
          },
        ]}
        numberOfLines={1}
      >
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: {
    width: designControl.lg,
    height: designControl.lg,
    borderRadius: designRadius.control,
    borderWidth: designTree.guide,
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 0,
    flexShrink: 0,
  },
});
