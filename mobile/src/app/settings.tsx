import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { back, push } from '@/services/appNavigation';
import { ScrollView, StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { Press } from '@/components/Press';

import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { useLibrary } from '@/state/LibraryContext';
import { useSettings } from '@/state/SettingsContext';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

export default function SettingsScreen() {
  const { config, swipeAction, setSwipeAction } = useSettings();
  const { ready, recordings } = useLibrary();
  const archived = recordings.filter((r) => r.archived).length;

  // Mostra ActivityIndicator enquanto as configuracoes e preferencias
  // do SecureStore nao sao lidas. Isso evita que a tela fique branca
  // ou bloqueada, dando ao usuario feedback de que o app esta trabalhando.
  const { ready: settingsReady } = useSettings();

  return (
    <Screen>
      <View style={styles.header}>
        <Press
          onPress={() => back()}
          style={styles.iconButton}
          accessibilityLabel="Voltar"
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Press>
        <Text style={styles.headerTitle}>Opções</Text>
        <View style={styles.iconButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Enquanto config/prefs nao carregam, mostra um indicador de carga no topo. */}
        {!ready || !settingsReady ? (
          <ActivityIndicator size="large" color={colors.textSecondary} />
        ) : (
          <React.Fragment>
            <Text style={styles.sectionLabel}>Lista</Text>
            <Card style={styles.card}>
              <Text style={styles.cardTitle}>Arrastar para o lado</Text>
              <Text style={styles.cardHint}>O que o gesto faz na tela inicial.</Text>
              <View style={styles.segment}>
                <Press
                  onPress={() => void setSwipeAction('delete')}
                  style={[styles.segmentItem, swipeAction === 'delete' && styles.segmentActive]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.segmentText, swipeAction === 'delete' && styles.segmentTextActive]}>
                    Apagar
                  </Text>
                </Press>
                <Press
                  onPress={() => void setSwipeAction('archive')}
                  style={[styles.segmentItem, swipeAction === 'archive' && styles.segmentActive]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.segmentText, swipeAction === 'archive' && styles.segmentTextActive]}>
                    Arquivar
                  </Text>
                </Press>
              </View>
            </Card>

            <Text style={styles.sectionLabel}>Métricas</Text>
            <Press onPress={() => push('/dashboard')}>
              <Card style={styles.row}>
                <Ionicons name="stats-chart-outline" size={20} color={colors.info} />
                <View style={styles.rowText}>
                  <Text style={styles.cardTitle}>Painel</Text>
                  <Text style={styles.cardHint}>Resumo, humor, tags e status do servidor.</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              </Card>
            </Press>

            <Press onPress={() => push('/storage')}>
              <Card style={styles.row}>
                <Ionicons name="save-outline" size={20} color={colors.info} />
                <View style={styles.rowText}>
                  <Text style={styles.cardTitle}>Armazenamento</Text>
                  <Text style={styles.cardHint}>Uso no aparelho e liberar espaço.</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              </Card>
            </Press>

            <Press onPress={() => push('/backup')}>
              <Card style={styles.row}>
                <Ionicons name="cloud-download-outline" size={20} color={colors.info} />
                <View style={styles.rowText}>
                  <Text style={styles.cardTitle}>Backup local</Text>
                  <Text style={styles.cardHint}>Salvar e restaurar tudo numa pasta.</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              </Card>
            </Press>

            <Press onPress={() => push('/transcription')}>
              <Card style={styles.row}>
                <Ionicons name="mic-circle-outline" size={20} color={colors.info} />
                <View style={styles.rowText}>
                  <Text style={styles.cardTitle}>Modelos no aparelho</Text>
                  <Text style={styles.cardHint}>Transcrição offline e modelos do aparelho.</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              </Card>
            </Press>

            <Text style={styles.sectionLabel}>Servidor</Text>
            <Press onPress={() => push('/server')}>
              <Card style={styles.row}>
                <Ionicons
                  name="cloud-outline"
                  size={20}
                  color={config ? colors.success : colors.warning}
                />
                <View style={styles.rowText}>
                  <Text style={styles.cardTitle}>{config ? 'Conectado' : 'Não configurado'}</Text>
                  <Text style={styles.cardHint} numberOfLines={1}>
                    {config ? config.baseUrl : 'Toque para configurar o servidor.'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              </Card>
            </Press>

            <Text style={styles.sectionLabel}>Avançado</Text>
            <Press onPress={() => push('/diagnostics')}>
              <Card style={styles.row}>
                <Ionicons name="pulse-outline" size={20} color={colors.info} />
                <View style={styles.rowText}>
                  <Text style={styles.cardTitle}>Diagnóstico da análise</Text>
                  <Text style={styles.cardHint}>Execuções, modelos e exportar métricas.</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              </Card>
            </Press>

            {archived > 0 ? (
              <Text style={styles.cardHint}>
                {archived} nota(s) arquivada(s) ficam no fim da lista.
              </Text>
            ) : null}
          </React.Fragment>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  content: { padding: spacing.xl, gap: spacing.lg },
  sectionLabel: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: spacing.sm,
  },
  card: { gap: spacing.sm },
  cardTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  cardHint: { color: colors.textSecondary, fontSize: fontSize.sm },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.bgElevated,
    borderRadius: radius.pill,
    padding: 3,
    gap: 3,
    marginTop: spacing.sm,
  },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.pill },
  segmentActive: { backgroundColor: colors.accent },
  segmentText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  segmentTextActive: { color: '#FFFFFF' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowText: { flex: 1, gap: 2 },
});