export type InkThemeName = "signal" | "mono" | "ember";

export const INK_THEME_NAMES: readonly InkThemeName[] = [
  "signal",
  "mono",
  "ember",
];

export function parseInkTheme(value: string | undefined): InkThemeName | undefined {
  const normalized = value?.trim().toLowerCase();
  return INK_THEME_NAMES.includes(normalized as InkThemeName)
    ? normalized as InkThemeName
    : undefined;
}
