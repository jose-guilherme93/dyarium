import { StyleSheet, View } from 'react-native';

import { designSpace, designTree } from '@/theme/design';

import { useDesign } from '../useDesign';

/**
 * Guias da arvore de projetos: uma linha vertical de 1px por nivel e um
 * cotovelo T/L por no, desenhados com Views (nunca caractere de desenho de
 * caixa). Cada celula tem `designTree.cell` de largura e o trilho mora em
 * `designTree.rail`.
 *
 * Celulas:
 *  - `v`     trilho inteiro (o nivel continua abaixo desta linha);
 *  - `top`   trilho ate a metade (ultimo filho de um nivel sem irmao depois);
 *  - `T`     cotovelo com trilho seguindo (tem irmao depois);
 *  - `L`     cotovelo fechando o nivel;
 *  - `none`  so recuo.
 */

export type GuideCell = 'none' | 'v' | 'top' | 'T' | 'L';

export interface GuidesProps {
  cells: GuideCell[];
}

export function Guides({ cells }: GuidesProps) {
  const colors = useDesign();
  const railColor = colors.line;

  if (cells.length === 0) return null;

  return (
    <View accessibilityElementsHidden style={styles.column}>
      {cells.map((cell, at) => (
        <View key={at} style={styles.cell}>
          {cell === 'v' || cell === 'T' ? (
            <View style={[styles.railFull, { backgroundColor: railColor }]} />
          ) : null}
          {cell === 'top' || cell === 'L' ? (
            <View style={[styles.railTop, { backgroundColor: railColor }]} />
          ) : null}
          {cell === 'T' || cell === 'L' ? (
            <View style={[styles.elbow, { backgroundColor: railColor }]} />
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    flexGrow: 0,
    flexShrink: 0,
    marginRight: -designSpace.s4,
  },
  cell: {
    width: designTree.cell,
    position: 'relative',
    flexGrow: 0,
    flexShrink: 0,
  },
  railFull: {
    position: 'absolute',
    left: designTree.rail,
    top: 0,
    bottom: 0,
    width: designTree.guide,
  },
  railTop: {
    position: 'absolute',
    left: designTree.rail,
    top: 0,
    height: '50%',
    width: designTree.guide,
  },
  elbow: {
    position: 'absolute',
    left: designTree.rail,
    top: '50%',
    width: designTree.cell - designTree.rail + designSpace.s4,
    height: designTree.guide,
  },
});
