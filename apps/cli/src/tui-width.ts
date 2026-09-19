const ANSI_SEQUENCE =
  /(?:\u001b\][\s\S]*?(?:\u0007|\u001b\\)|\u001b\[[0-?]*[ -/]*[@-~]|\u001b[()][0-2A-Z0-9]|\u001b[=>?].|\u001b.)/g;

const COMBINING_RANGES: readonly (readonly [number, number])[] = [
  [0x0300, 0x036f],
  [0x0483, 0x0489],
  [0x0591, 0x05bd],
  [0x05bf, 0x05bf],
  [0x05c1, 0x05c2],
  [0x05c4, 0x05c5],
  [0x0610, 0x061a],
  [0x064b, 0x065f],
  [0x0670, 0x0670],
  [0x06d6, 0x06dc],
  [0x06df, 0x06e4],
  [0x06e7, 0x06e8],
  [0x06ea, 0x06ed],
  [0x0711, 0x0711],
  [0x0730, 0x074a],
  [0x07a6, 0x07b0],
  [0x07eb, 0x07f3],
  [0x0816, 0x0819],
  [0x081b, 0x0823],
  [0x0825, 0x0827],
  [0x0829, 0x082d],
  [0x0859, 0x085b],
  [0x08d3, 0x0903],
  [0x093a, 0x093c],
  [0x093e, 0x094f],
  [0x0951, 0x0957],
  [0x0962, 0x0963],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x20d0, 0x20ff],
  [0xfe00, 0xfe0f],
  [0xfe20, 0xfe2f],
  [0xe0100, 0xe01ef],
];

const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x231a, 0x231b],
  [0x2329, 0x232a],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x2e80, 0x303e],
  [0x3040, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff01, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f004, 0x1f004],
  [0x1f0cf, 0x1f0cf],
  [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a],
  [0x1f200, 0x1f251],
  [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff],
  [0x1f7e0, 0x1f7eb],
  [0x1f90c, 0x1f9ff],
  [0x1fa70, 0x1faff],
  [0x20000, 0x3fffd],
];

function inRanges(codePoint: number, ranges: readonly (readonly [number, number])[]): boolean {
  return ranges.some(([start, end]) => codePoint >= start && codePoint <= end);
}

function isCombining(codePoint: number): boolean {
  return inRanges(codePoint, COMBINING_RANGES);
}

function isWide(codePoint: number): boolean {
  return inRanges(codePoint, WIDE_RANGES);
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_SEQUENCE, "");
}

function isZeroWidth(codePoint: number): boolean {
  return (
    codePoint === 0x200b ||
    codePoint === 0x200c ||
    codePoint === 0x200d ||
    codePoint === 0x2060 ||
    codePoint === 0xfeff ||
    isCombining(codePoint)
  );
}

function clusterize(value: string): string[] {
  const clusters: string[] = [];
  let current = "";

  const flush = (): void => {
    if (current) {
      clusters.push(current);
      current = "";
    }
  };

  for (const character of Array.from(stripAnsi(value))) {
    if (character === "\n") {
      flush();
      clusters.push("\n");
      continue;
    }

    const codePoint = character.codePointAt(0) ?? 0;
    if (
      current.endsWith("\u200d") ||
      isZeroWidth(codePoint) ||
      (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff)
    ) {
      current += character;
      continue;
    }

    flush();
    current = character;
  }

  flush();
  return clusters;
}

function clusterWidth(cluster: string): number {
  if (cluster === "\n" || cluster.length === 0) return 0;
  if (cluster.includes("\u200d")) return 2;

  const codePoint = cluster.codePointAt(0) ?? 0;
  if (isCombining(codePoint) || isZeroWidth(codePoint)) return 0;
  if (isWide(codePoint)) return 2;
  return 1;
}

/** Returns the number of terminal cells occupied by a string. */
export function displayWidth(value: string): number {
  let lineWidth = 0;
  let maxWidth = 0;

  for (const cluster of clusterize(value)) {
    if (cluster === "\n") {
      maxWidth = Math.max(maxWidth, lineWidth);
      lineWidth = 0;
      continue;
    }
    lineWidth += clusterWidth(cluster);
  }

  return Math.max(maxWidth, lineWidth);
}

/**
 * Splits a string into display-cell-bounded chunks without splitting a
 * surrogate pair, combining sequence, or joined emoji sequence.
 */
export function splitByDisplayWidth(value: string, width: number): string[] {
  const limit = Math.max(1, Math.floor(width));
  const chunks: string[] = [];
  let current = "";
  let currentWidth = 0;

  const flush = (): void => {
    if (current) {
      chunks.push(current);
      current = "";
      currentWidth = 0;
    }
  };

  for (const cluster of clusterize(value)) {
    if (cluster === "\n") {
      flush();
      chunks.push("");
      continue;
    }

    const widthForCluster = clusterWidth(cluster);
    if (current && currentWidth + widthForCluster > limit) {
      flush();
    }

    current += cluster;
    currentWidth += widthForCluster;
  }

  flush();
  return chunks.length > 0 ? chunks : [""];
}

/** Truncates to terminal cells, adding a single-cell ellipsis when needed. */
export function truncateToDisplayWidth(value: string, width: number): string {
  const limit = Math.max(0, Math.floor(width));
  if (limit === 0) return "";

  const clean = stripAnsi(value);
  if (displayWidth(clean) <= limit) return clean;
  if (limit === 1) return "…";

  const chunks = splitByDisplayWidth(clean, limit - 1);
  const first = chunks[0] ?? "";
  return `${first}…`;
}

/** Truncates and pads a value to exactly the requested terminal width. */
export function fitDisplayLine(value: string, width: number): string {
  const limit = Math.max(0, Math.floor(width));
  const fitted = truncateToDisplayWidth(value, limit);
  return `${fitted}${" ".repeat(Math.max(0, limit - displayWidth(fitted)))}`;
}
