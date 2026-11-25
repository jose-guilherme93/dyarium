import { StyleSheet, Text, TextInput, View } from 'react-native';

import {
  designControl,
  designFont,
  designRadius,
  designSpace,
  designType,
} from '@/theme/design';

import { useDesign } from './useDesign';

export interface FieldProps {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  editable?: boolean;
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  editable = true,
}: FieldProps) {
  const colors = useDesign();

  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.textMuted }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        editable={editable}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={[
          styles.input,
          {
            backgroundColor: colors.surfaceAlt,
            borderColor: colors.line,
            color: colors.text,
          },
        ]}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: designSpace.s2,
  },
  label: {
    fontFamily: designFont.regular,
    fontSize: designType.label.size,
    lineHeight: designType.label.size * designType.label.lineHeight,
    letterSpacing: designType.label.letterSpacing,
    textTransform: 'uppercase',
  },
  input: {
    height: designControl.md,
    paddingHorizontal: designControl.padMd,
    paddingVertical: 0,
    borderWidth: 1,
    borderRadius: designRadius.control,
    fontFamily: designFont.regular,
    fontSize: designType.body.size,
  },
});
