const NO_COLOR = process.env.NO_COLOR !== undefined;

export const colors = {
  reset: NO_COLOR ? "" : "[0m",
  cyan: NO_COLOR ? "" : "[36m",
  red: NO_COLOR ? "" : "[31m",
  yellow: NO_COLOR ? "" : "[33m",
  green: NO_COLOR ? "" : "[32m",
  dim: NO_COLOR ? "" : "[2m",
};

export function colorize(text: string, color: keyof Omit<typeof colors, "reset">): string {
  if (NO_COLOR) return text;
  return `${colors[color]}${text}${colors.reset}`;
}
