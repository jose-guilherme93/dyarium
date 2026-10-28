/**
 * Onda da gravacao.
 *
 * Duas coisas andam em ritmos diferentes de proposito:
 *
 * - O **deslocamento** da fita e continuo, a 60 fps, na thread de UI
 *   (`useAnimatedStyle` com um unico `translateX`). Nao re-renderiza o JS nem
 *   recalcula o desenho.
 * - O **desenho** das barras e um unico `Path` SVG, refeito so quando uma
 *   amostra entra (uma vez por barra, ~17/s). Uma view por barra custava
 *   dezenas de atualizacoes de estilo por amostra; refazer o path a cada quadro
 *   custava uma atualizacao grande por quadro. Separando os dois, o quadro so
 *   mexe no translado.
 *
 * O JS entrega o nivel do microfone numa fila compartilhada, a cada 35 ms; nao
 * ha `setState` por amostra nem render da tela.
 *
 * A fita desenha uma barra a mais que a area visivel. Quando o deslocamento
 * chega a exatamente uma barra, a UI consome a amostra mais nova (a fita anda
 * uma posicao) e o deslocamento volta a zero no mesmo quadro. Como o desenho de
 * antes e o de depois sao o mesmo, nao existe salto no encontro.
 */

import { useEffect, useRef, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import {
  BAR_GAP,
  MIN_LEVEL,
  SAMPLE_MS,
  stepLiveWave,
  wavePath,
} from '@/components/liveWaveAnimation';
import {
  createMeterTrack,
  levelFromTrack,
  METER_SILENCE_DB,
  smoothMetering,
  trackMeter,
  type MeterTrack,
} from '@/core/waveform';
import { useTheme } from '@/theme/ThemeContext';

/**
 * Quantas barras na tela. O dobro das 44 originais: a onda fica mais fina e
 * densa como um gravador de verdade, e o passo menor deixa o silencio e a fala
 * mais faceis de comparar. O desenho continua sendo um unico `Path`.
 */
const DEFAULT_BARS = 88;

const AnimatedPath = Animated.createAnimatedComponent(Path);

interface LiveWaveformProps {
  /** Gravando (a onda anda). Fora disso, as barras ficam no minimo. */
  active: boolean;
  /** Pausado: mantem as barras, mais discretas. */
  paused?: boolean;
  /**
   * Le o nivel do microfone em dB na hora da amostra. O componente amostra, no
   * ritmo dele, sem re-renderizar a tela.
   */
  sampleMetering?: () => number;
  bars?: number;
  height?: number;
  color?: string;
}

export function LiveWaveform({
  active,
  paused = false,
  sampleMetering,
  bars = DEFAULT_BARS,
  height = 120,
  color,
}: LiveWaveformProps) {
  const { colors } = useTheme();
  const barColor = color ?? colors.accent;

  const [width, setWidth] = useState(0);
  const step = width > 0 ? width / bars : 0;
  const barWidth = Math.max(2, step - BAR_GAP);
  const maxBarHeight = Math.max(6, height * 0.9);

  /** Fita da onda (mais antiga -> mais nova), uma barra a mais que a area. */
  const tape = useSharedValue<number[]>(new Array(bars + 1).fill(MIN_LEVEL));
  /** Ultima amostra entregue pelo JS. O `seq` so muda com uma amostra nova. */
  const pending = useSharedValue({ level: MIN_LEVEL, seq: 0 });
  const consumedSeq = useSharedValue(0);
  /** Deslocamento da fita, em barras (0..1). */
  const shift = useSharedValue(0);
  const stepS = useSharedValue(0);
  const running = useSharedValue(false);
  /** Envelope em dB: ataque imediato e queda suave entre as amostras. */
  const envelopeDb = useRef(METER_SILENCE_DB);
  /**
   * Faixa observada (ruido -> pico). E o que da sensibilidade: a fala chega ao
   * topo mesmo num aparelho que mede baixo.
   */
  const track = useRef<MeterTrack | null>(null);

  useEffect(() => {
    stepS.value = step;
  }, [step, stepS]);

  useEffect(() => {
    running.value = active && !paused;
  }, [active, paused, running]);

  // Gravacao nova (ou parada): fita no minimo e sem amostra pendente.
  useEffect(() => {
    if (active) return;
    tape.value = new Array(bars + 1).fill(MIN_LEVEL);
    pending.value = { level: MIN_LEVEL, seq: 0 };
    consumedSeq.value = 0;
    shift.value = 0;
    envelopeDb.current = METER_SILENCE_DB;
    track.current = null;
  }, [active, bars, tape, pending, consumedSeq, shift]);

  // Amostragem no JS, sem estado: o medidor entra na fila da UI com um `seq`.
  useEffect(() => {
    if (!active || paused || !sampleMetering) return undefined;
    let last = Date.now();
    envelopeDb.current = METER_SILENCE_DB;
    const timer = setInterval(() => {
      const now = Date.now();
      const delta = now - last;
      last = now;
      const metering = sampleMetering();
      envelopeDb.current = smoothMetering(envelopeDb.current, metering, delta);
      const previous = track.current;
      const next = previous
        ? trackMeter(previous, metering, delta)
        : createMeterTrack(metering);
      track.current = next;
      pending.value = {
        level: Math.min(1, Math.max(MIN_LEVEL, levelFromTrack(next, envelopeDb.current))),
        seq: pending.value.seq + 1,
      };
    }, SAMPLE_MS);
    return () => clearInterval(timer);
  }, [active, paused, sampleMetering, pending]);

  const frameCallback = useFrameCallback((frame) => {
    'worklet';
    const dt = frame.timeSincePreviousFrame ?? 0;
    stepLiveWave({ tape, pending, consumedSeq, shift, running }, dt);
  }, false);

  useEffect(() => {
    frameCallback.setActive(active && !paused);
  }, [active, paused, frameCallback]);

  /** O desenho so muda quando a fita muda (uma vez por barra). */
  const pathProps = useAnimatedProps(() => ({
    d: wavePath(tape.value, stepS.value, height, maxBarHeight),
  }));

  /** O quadro so mexe no translado: nenhum string nem estilo por barra. */
  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -shift.value * stepS.value }],
  }));

  const handleLayout = (event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  };

  return (
    <View
      testID="live-waveform"
      style={{ width: '100%', height, opacity: paused ? 0.45 : 1, overflow: 'hidden' }}
      onLayout={handleLayout}
      accessible={false}
    >
      <Animated.View style={[{ width: width + step, height }, rowStyle]}>
        <Svg width={width + step} height={height} testID="live-waveform-svg">
          <AnimatedPath
            testID="wave-path"
            animatedProps={pathProps}
            stroke={barColor}
            strokeWidth={barWidth}
            strokeLinecap="round"
            fill="none"
          />
        </Svg>
      </Animated.View>
    </View>
  );
}
