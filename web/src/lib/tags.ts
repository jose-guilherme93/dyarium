/**
 * Cores de tag: a mesma paleta e o mesmo hash do servidor e do app
 * (`internal/store/tags.go`, `mobile/src/core/tags.ts`).
 */

export const TAG_PALETTE = [
  "#F2C4C4",
  "#F4D6B8",
  "#EFE3A8",
  "#C9E4C5",
  "#BFE1DF",
  "#C7D8F2",
  "#D8CCEF",
  "#EEC7DE",
] as const;

export function tagColor(name: string, stored?: string): string {
  if (stored?.trim()) return stored.trim();
  let hash = 2166136261;
  for (const char of name.trim().toLowerCase()) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return TAG_PALETTE[(hash >>> 0) % TAG_PALETTE.length];
}

export function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const value = Number.parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(value)) return `rgba(255,255,255,${alpha})`;
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
