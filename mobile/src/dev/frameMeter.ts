/**
 * Medidor de quadro em desenvolvimento.
 *
 * O gesto do mapa so pode ser julgado por numero: este worklet mede o intervalo
 * real entre quadros da thread de UI (o mesmo relogio que o desenho usa) e
 * imprime p50, p95 e o pior quadro a cada ~120 quadros. E o numero que vale
 * para dizer se o gesto esta a 60 fps ou travando -- e nao o tempo de um
 * componente do React.
 *
 * Em producao nada e registrado: a exportacao e um no-op.
 */

import { useCallback, useEffect } from 'react';
import { runOnJS, useFrameCallback, useSharedValue } from 'react-native-reanimated';

import { formatSummary, hudSummary, summarize } from './frameStats';

function useFrameMeterDev(label: string, onReport?: (text: string) => void): void {
  const window = useSharedValue<number[]>([]);
  const report = useCallback(
    (deltas: number[]) => {
      const summary = summarize(deltas);
      console.log(formatSummary(label, summary));
      onReport?.(hudSummary(summary));
    },
    [label, onReport],
  );
  useFrameCallback((info) => {
    'worklet';
    const delta = info.timeSincePreviousFrame;
    if (delta === null || delta <= 0) return;
    const list = window.value;
    if (list.length >= 120) {
      runOnJS(report)(list);
      window.value = [delta];
      return;
    }
    window.value = [...list, delta];
  }, true);
}

export const useFrameMeter: (label: string, onReport?: (text: string) => void) => void = __DEV__
  ? useFrameMeterDev
  : () => undefined;

/**
 * Cadencia da thread de JS. O desenho do Skia pode acontecer fora dela, entao
 * um gesto lento com a thread de UI a 60 Hz ainda pode ser a thread de JS
 * engasgada. Este laco usa o mesmo `requestAnimationFrame` que o app usa.
 */
export function useJsFrameMeter(label: string): void {
  useEffect(() => {
    if (!__DEV__) return;
    let last = 0;
    let samples: number[] = [];
    let raf = 0;
    const tick = (time: number) => {
      if (last > 0) {
        samples.push(time - last);
        if (samples.length >= 120) {
          const summary = summarize(samples);
          console.log(`[jsframe] ${label} n=${summary.n} p50=${summary.p50.toFixed(1)} p95=${summary.p95.toFixed(1)} max=${summary.max.toFixed(1)} >16=${summary.over}`);
          samples = [];
        }
      }
      last = time;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [label]);
}
