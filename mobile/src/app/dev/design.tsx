import { Redirect, Stack } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSettings } from '@/state/SettingsContext';
import { designFont, designSpace, designType } from '@/theme/design';
import type { DesignColors, DesignThemeName } from '@/theme/design';
import { Button, Field, Meter, useDesign } from '@/ui';

const THEMES: DesignThemeName[] = ['light', 'dark', 'amoled'];

/**
 * Especime das primitivas na tela, na paleta ativa. E a versao do app de
 * docs/design/index.html: serve para olhar o sistema no aparelho com a fonte de
 * verdade em docs/design/tokens.json. Nao entra no app de producao.
 */
export default function DesignScreen() {
  if (!__DEV__) return <Redirect href="/" />;
  return <Body />;
}

function Body() {
  const insets = useSafeAreaInsets();
  const colors = useDesign();
  const { theme, setTheme } = useSettings();

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={{ backgroundColor: colors.surface }}
        contentContainerStyle={{
          paddingTop: insets.top + designSpace.s8,
          paddingBottom: insets.bottom + designSpace.s16,
          paddingHorizontal: designSpace.s12,
          gap: designSpace.s8,
        }}
      >
        <View style={styles.row}>
          {THEMES.map((name) => (
            <Pressable
              key={name}
              onPress={() => void setTheme(name)}
              style={{
                borderWidth: 1,
                borderColor: name === theme ? colors.primary : colors.line,
                borderRadius: 2,
                paddingHorizontal: designSpace.s6,
                paddingVertical: designSpace.s2,
              }}
            >
              <Text style={[type('label', colors), { color: name === theme ? colors.text : colors.textMuted }]}>
                {name}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.line }} />

        <Text style={[type('display', colors), { color: colors.text }]}>Reunião com fornecedor</Text>
        <Text style={[type('title', colors), { color: colors.text }]}>Ideia de captura offline</Text>
        <Text style={[type('body', colors), { color: colors.text }]}>Consulta médica — 4 mar, 14h30.</Text>

        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.line }} />

        <View style={styles.row}>
          <Button title="salvar" variant="primary" size="md" onPress={() => undefined} />
          <Button title="editar" variant="secondary" size="md" onPress={() => undefined} />
          <Button title="ver" variant="ghost" size="md" onPress={() => undefined} />
        </View>
        <View style={styles.row}>
          <Button title="salvar" variant="primary" size="sm" onPress={() => undefined} />
          <Button title="salvar" variant="primary" size="md" onPress={() => undefined} />
          <Button title="salvar" variant="primary" size="lg" onPress={() => undefined} />
        </View>
        <View style={styles.row}>
          <Button title="apagar" variant="primary" size="md" disabled />
          <Button title="cancelar" variant="ghost" size="md" disabled />
        </View>

        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.line }} />

        <Field label="nota" value="Consulta médica" onChangeText={() => undefined} />
        <Meter value={18} max={28} label="transcrição" />
        <Meter value={62} label="sincronizado" />
      </ScrollView>
    </>
  );
}

function type(level: 'display' | 'title' | 'body' | 'label', colors: DesignColors) {
  const t = designType[level];
  return {
    fontFamily: level === 'display' || level === 'title' ? designFont.semibold : designFont.regular,
    fontSize: t.size,
    lineHeight: Math.round(t.size * t.lineHeight),
    letterSpacing: t.letterSpacing * t.size,
    textTransform: level === 'label' ? ('uppercase' as const) : ('none' as const),
    color: colors.text,
  };
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: designSpace.s8, flexWrap: 'wrap', alignItems: 'center' },
});
