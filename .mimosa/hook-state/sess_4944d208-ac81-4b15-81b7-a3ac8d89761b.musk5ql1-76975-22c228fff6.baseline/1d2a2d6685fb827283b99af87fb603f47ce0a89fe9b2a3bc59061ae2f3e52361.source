const NO_COLOR = process.env.NO_COLOR !== undefined;

export interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export const colors = {
  reset: NO_COLOR ? "" : "[0m",
  cyan: NO_COLOR ? "" : "[36m",
  teal: NO_COLOR ? "" : "[36m",
  red: NO_COLOR ? "" : "[31m",
  danger: NO_COLOR ? "" : "[31m",
  yellow: NO_COLOR ? "" : "[33m",
  amber: NO_COLOR ? "" : "[33m",
  green: NO_COLOR ? "" : "[32m",
  success: NO_COLOR ? "" : "[32m",
  blue: NO_COLOR ? "" : "[34m",
  magenta: NO_COLOR ? "" : "[35m",
  bold: NO_COLOR ? "" : "[1m",
  dim: NO_COLOR ? "" : "[2m",
};

export function colorize(text: string, color: keyof Omit<typeof colors, "reset">): string {
  if (NO_COLOR) return text;
  return `${colors[color]}${text}${colors.reset}`;
}

function channel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function colorizeRgb(text: string, color: RgbColor): string {
  if (NO_COLOR || text.length === 0) return text;
  return `\u001b[38;2;${channel(color.r)};${channel(color.g)};${channel(color.b)}m${text}${colors.reset}`;
}

function interpolate(start: RgbColor, end: RgbColor, ratio: number): RgbColor {
  return {
    r: start.r + (end.r - start.r) * ratio,
    g: start.g + (end.g - start.g) * ratio,
    b: start.b + (end.b - start.b) * ratio,
  };
}

function gradientColor(stops: readonly RgbColor[], ratio: number): RgbColor {
  if (stops.length === 0) return { r: 255, g: 255, b: 255 };
  if (stops.length === 1) return stops[0]!;
  const scaled = Math.max(0, Math.min(1, ratio)) * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  return interpolate(stops[index]!, stops[index + 1]!, scaled - index);
}

/** Applies a truecolor gradient to visible characters while preserving layout whitespace. */
export function colorizeGradient(text: string, stops: readonly RgbColor[]): string {
  if (NO_COLOR || text.length === 0) return text;

  const characters = Array.from(text);
  const paintableCount = characters.filter((character) => !/\s/.test(character)).length;
  if (paintableCount === 0) return text;

  let paintableIndex = 0;
  return characters
    .map((character) => {
      if (/\s/.test(character)) return character;
      const ratio = paintableCount === 1 ? 0 : paintableIndex / (paintableCount - 1);
      paintableIndex += 1;
      return colorizeRgb(character, gradientColor(stops, ratio));
    })
    .join("");
}
