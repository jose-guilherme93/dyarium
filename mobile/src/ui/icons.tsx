import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { designIcon } from '@/theme/design';

import { useDesign } from './useDesign';

/**
 * Nome do desenho, o mesmo de `docs/design/icons.json`. O web desenha o
 * caminho gerado; o app aponta para o Ionicons mais proximo do mesmo desenho.
 */
export type IconName = (typeof designIcon.set)[number];

type Glyph = keyof typeof Ionicons.glyphMap;

const MAP: Record<IconName, Glyph> = {
  menu: 'menu',
  plus: 'add',
  back: 'chevron-back',
  forward: 'chevron-forward',
  search: 'search',
  mic: 'mic-outline',
  panel: 'albums-outline',
  theme: 'contrast-outline',
  more: 'ellipsis-horizontal',
  tree: 'git-branch-outline',
  book: 'book-outline',
  grid: 'grid-outline',
  sync: 'sync-outline',
  close: 'close',
  chevron: 'chevron-down',
  check: 'checkmark',
  pin: 'pin-outline',
  tag: 'pricetags-outline',
  alert: 'alert-outline',
  cloud: 'cloud-upload-outline',
  server: 'server-outline',
  sort: 'swap-vertical-outline',
  chart: 'stats-chart-outline',
  image: 'image-outline',
  link: 'link-outline',
  doc: 'document-text-outline',
  clock: 'time-outline',
  bell: 'notifications-outline',
  calendar: 'calendar-outline',
  network: 'git-network-outline',
  trash: 'trash-outline',
  play: 'play',
  pause: 'pause',
  stop: 'stop',
  gear: 'settings-outline',
};

/** Nome do Ionicons para um desenho do sistema. */
export function iconFor(name: IconName): Glyph {
  return MAP[name];
}

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  /** Sem rotulo, o icone e decorativo para o leitor de tela. */
  label?: string;
}

/** Icone do sistema no app. Alvo e rotulo ficam com quem desenha o botao. */
export function Icon({ name, size = designIcon.md, color, label }: IconProps) {
  const colors = useDesign();
  const glyph = (
    <Ionicons
      name={MAP[name]}
      size={size}
      color={color ?? colors.textMuted}
      accessible={false}
      importantForAccessibility="no"
    />
  );

  if (!label) return glyph;

  return (
    <View style={styles.wrap} accessible accessibilityRole="image" accessibilityLabel={label}>
      {glyph}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
});
