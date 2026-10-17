/**
 * Feature flags do app. O valor vem de `EXPO_PUBLIC_*` e e fixado no bundle;
 * esta funcao pura existe para testar a leitura sem depender do ambiente.
 */
export function localAnalysisEnabled(
  value: string | undefined = process.env.EXPO_PUBLIC_LOCAL_ANALYSIS,
): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true';
}
