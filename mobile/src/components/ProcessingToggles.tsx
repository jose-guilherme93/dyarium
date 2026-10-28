/**
 * Os tres interruptores que decidem o que acontece com a nota: transcrever,
 * analisar e processar no servidor.
 *
 * Sem servidor configurado o terceiro fica travado; sem motor nativo e sem
 * servidor, a etapa correspondente nao tem quem execute e o interruptor
 * explica isso com um atalho, sem banner nem aviso automatico.
 */

import { Ionicons } from '@expo/vector-icons';
import { Switch, View } from 'react-native';

import { Text } from '@/components/AppText';
import { Press } from '@/components/Press';
import { push } from '@/services/appNavigation';
import { installedAnalysisModels } from '@/services/analysisModels';
import { localAnalysisCapable } from '@/services/processing';
import { installedModels } from '@/services/transcriptionModels';
import { localTranscriptionAvailable } from '@/services/whisper';
import { useSettings } from '@/state/SettingsContext';
import { baseColors, fontSize, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

interface ProcessingTogglesProps {
  /** Esconde o que e obvio dentro da folha (titulo ja diz). */
  compact?: boolean;
}

export function ProcessingToggles({ compact = false }: ProcessingTogglesProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();
  const {
    config,
    transcriptionEnabled,
    setTranscriptionEnabled,
    analysisEnabled,
    setAnalysisEnabled,
    serverProcessing,
    setServerProcessing,
    transcriptionModel,
    analysisModel,
  } = useSettings();

  const hasServer = Boolean(config);
  const transcriptionCapable = localTranscriptionAvailable();
  const transcriptionReady = installedModels().some((model) => model.id === transcriptionModel);
  const analysisCapable = localAnalysisCapable();
  const analysisReady = installedAnalysisModels().some((model) => model.id === analysisModel);
  // Sem servidor e sem motor, a etapa nao tem onde rodar: o interruptor nao
  // promete o que nao pode cumprir.
  const transcriptionPossible = hasServer || transcriptionCapable;
  const analysisPossible = hasServer || analysisCapable;

  return (
    <View style={styles.list}>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.title}>Transcrição</Text>
          {!transcriptionPossible ? (
            <Text style={styles.hint}>Indisponível neste build.</Text>
          ) : transcriptionEnabled && !serverProcessing && !transcriptionReady ? (
            <Press onPress={() => push('/transcription')} accessibilityRole="button">
              <Text style={styles.action}>Baixar modelo</Text>
            </Press>
          ) : null}
        </View>
        <Switch
          value={transcriptionEnabled}
          onValueChange={(value) => void setTranscriptionEnabled(value)}
          disabled={!transcriptionPossible}
          trackColor={{ true: colors.accent }}
          accessibilityLabel="Transcrever as notas"
        />
      </View>

      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.title}>Análise</Text>
          {!analysisPossible ? (
            <Text style={styles.hint}>Indisponível neste aparelho.</Text>
          ) : analysisEnabled && !serverProcessing && !analysisReady ? (
            <Press onPress={() => push('/transcription')} accessibilityRole="button">
              <Text style={styles.action}>Baixar modelo</Text>
            </Press>
          ) : null}
        </View>
        <Switch
          value={analysisEnabled}
          onValueChange={(value) => void setAnalysisEnabled(value)}
          disabled={!analysisPossible}
          trackColor={{ true: colors.accent }}
          accessibilityLabel="Analisar as notas"
        />
      </View>

      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.title}>Processar no servidor</Text>
          {!hasServer ? (
            <Press onPress={() => push('/server')} accessibilityRole="button">
              <Text style={styles.action}>Conectar servidor</Text>
            </Press>
          ) : null}
        </View>
        <Switch
          value={serverProcessing}
          onValueChange={(value) => void setServerProcessing(value)}
          disabled={!hasServer}
          trackColor={{ true: colors.accent }}
          accessibilityLabel="Processar no servidor"
        />
      </View>

      {compact ? null : (
        <View style={styles.foot}>
          <Ionicons name="sync-outline" size={14} color={colors.textTertiary} />
          <Text style={styles.footText}>
            {hasServer
              ? 'O que termina de um lado chega pronto no outro.'
              : 'Sem servidor, tudo fica neste aparelho.'}
          </Text>
        </View>
      )}
    </View>
  );
}

const baseStyles = defineStyles({
  list: { gap: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowText: { flex: 1, gap: 2 },
  title: { color: baseColors.text, fontSize: fontSize.md, fontWeight: '600' },
  hint: { color: baseColors.textSecondary, fontSize: fontSize.sm },
  action: { color: baseColors.accent, fontSize: fontSize.sm, fontWeight: '600' },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: baseColors.border,
    paddingTop: spacing.sm,
  },
  footText: { color: baseColors.textTertiary, fontSize: fontSize.xs },
});
