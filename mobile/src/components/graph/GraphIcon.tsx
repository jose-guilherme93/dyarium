/** Icone monocromatico do mapa, desenhado a partir da paleta de caminhos. */

import Svg, { Path } from 'react-native-svg';

import { iconKeyFor, iconPaths } from '@/core/graphIcons';
import type { GraphNodeKind } from '@/core/graphModel';

interface GraphIconProps {
  kind: GraphNodeKind;
  icon?: string;
  size?: number;
  color: string;
}

export function GraphIcon({ kind, icon, size = 18, color }: GraphIconProps) {
  const paths = iconPaths(iconKeyFor(kind, icon));
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {paths.map((d, index) => (
        <Path
          key={index}
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
}
