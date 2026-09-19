import { colorize } from "./colors.js";
import { displayWidth, truncateToDisplayWidth } from "./tui-width.js";

export interface SignalLoomMarkOptions {
  width?: number;
  color?: boolean;
  compact?: boolean;
}

function fit(value: string, width: number): string {
  return truncateToDisplayWidth(value, Math.max(1, Math.floor(width)));
}

function paint(value: string, color: "teal" | "amber" | "bold", enabled: boolean): string {
  return enabled ? colorize(value, color) : value;
}

/** Renders the terminal-safe Signal Loom mark in compact or full form. */
export function renderSignalLoomMark(options: SignalLoomMarkOptions = {}): string {
  const width = Math.max(1, Math.floor(options.width ?? 16));
  const useColor = options.color !== false;
  const compact = options.compact === true || width < 12;
  const lines = compact
    ? ["╭─╮", "╰<>╯", "╰─╯"]
    : ["  ╲╱  ╲╱", "╭─╾<>╼─╮", "  ╱╲  ╱╲"];

  return lines
    .map((line, index) => {
      const color = index === 1 ? "amber" : "teal";
      return paint(fit(line, width), color, useColor);
    })
    .join("\n");
}

export function renderSignalLoomWordmark(options: {
  width?: number;
  color?: boolean;
} = {}): string {
  const width = Math.max(1, Math.floor(options.width ?? 24));
  const value = "DEV AGENT";
  return paint(
    fit(value, width),
    "bold",
    options.color !== false && displayWidth(value) <= width
  );
}

/** Checked-in Desktop and documentation asset source for the same geometry. */
export function renderSignalLoomSvg(): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Signal Loom">',
    '  <rect x="4" y="4" width="56" height="56" rx="8" fill="none" stroke="#58d6d1" stroke-width="3"/>',
    '  <path d="M14 18 28 32 14 46M50 18 36 32l14 14" fill="none" stroke="#58d6d1" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
    '  <path d="M25 32h14" fill="none" stroke="#f5b942" stroke-width="4" stroke-linecap="round"/>',
    "</svg>",
  ].join("\n");
}
