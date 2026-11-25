import { push } from '@/services/appNavigation';
import { Text } from '@/components/AppText';
import { Press } from '@/components/Press';
import { useDrive } from '@/state/useDrive';
import {
  designFont,
  designRow,
  designSpace,
  designType,
} from '@/theme/design';
import { Icon } from '@/ui/icons';
import { useDesign } from '@/ui/useDesign';

export function DriveExpiredBanner() {
  const colors = useDesign();
  const drive = useDrive();
  if (drive.status !== 'expired') return null;
  return (
    <Press
      onPress={() => push('/drive')}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: designSpace.s6,
        height: designRow.touch,
        paddingHorizontal: designSpace.s16,
        backgroundColor: colors.surfaceAlt,
        borderBottomWidth: 1,
        borderBottomColor: colors.line,
      }}
      accessibilityRole="button"
      accessibilityLabel="Drive sessão vencida, reconectar"
    >
      <Icon name="alert" size={14} color={colors.warning} />
      <Text style={{ flex: 1, color: colors.text, fontSize: designType.body.size }}>
        Drive · sessão vencida
      </Text>
      <Text
        style={{
          color: colors.warning,
          fontFamily: designFont.semibold,
          fontSize: designType.label.size,
          textTransform: 'uppercase',
          letterSpacing: designType.label.letterSpacing,
        }}
      >
        Reconectar
      </Text>
    </Press>
  );
}
