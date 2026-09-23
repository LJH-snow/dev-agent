import { createContext, useContext } from "react";

import {
  INK_THEME_NAMES,
  parseInkTheme,
  type InkThemeName,
} from "./theme-types.js";

export { INK_THEME_NAMES, parseInkTheme };
export type { InkThemeName };

export interface InkTheme {
  readonly name: InkThemeName;
  readonly text: string;
  readonly muted: string;
  readonly dim: string;
  readonly accent: string;
  readonly primary: string;
  readonly success: string;
  readonly warning: string;
  readonly error: string;
  readonly info: string;
  readonly border: string;
  readonly composer: string;
  readonly prompt: string;
  readonly code: string;
  readonly quote: string;
  readonly thinking: readonly string[];
  readonly logo: readonly string[];
}

export const INK_THEMES: Readonly<Record<InkThemeName, InkTheme>> = {
  signal: {
    name: "signal",
    text: "#eef3ff",
    muted: "#8d97ab",
    dim: "#6f7fa8",
    accent: "#c792ff",
    primary: "#67a9ff",
    success: "#75d88b",
    warning: "#f2c15d",
    error: "#f17d89",
    info: "#67d9d7",
    border: "#6f7fa8",
    composer: "#67a9ff",
    prompt: "#c792ff",
    code: "#8bd5ff",
    quote: "#7f8fb8",
    thinking: ["#6fb8ff", "#80c2ff", "#9ed0ff", "#c5e4ff"],
    logo: ["#4b9eff", "#6c85e3", "#8d74d0", "#ac70ad", "#c86b92"],
  },
  mono: {
    name: "mono",
    text: "#f2f2f2",
    muted: "#a8a8a8",
    dim: "#777777",
    accent: "#d6d6d6",
    primary: "#f2f2f2",
    success: "#d6d6d6",
    warning: "#f2f2f2",
    error: "#f2f2f2",
    info: "#d6d6d6",
    border: "#a8a8a8",
    composer: "#f2f2f2",
    prompt: "#d6d6d6",
    code: "#e4e4e4",
    quote: "#999999",
    thinking: ["#a8a8a8", "#c2c2c2", "#dedede", "#f2f2f2"],
    logo: ["#bdbdbd", "#c9c9c9", "#d6d6d6", "#e2e2e2", "#f2f2f2"],
  },
  ember: {
    name: "ember",
    text: "#fff4e6",
    muted: "#b89b87",
    dim: "#98745d",
    accent: "#ffb86b",
    primary: "#ff9966",
    success: "#b6d58a",
    warning: "#ffd166",
    error: "#ff7b72",
    info: "#f4a261",
    border: "#b87955",
    composer: "#ff9966",
    prompt: "#ffb86b",
    code: "#ffd6a5",
    quote: "#c69c82",
    thinking: ["#e58f65", "#f0a36e", "#ffc078", "#ffe0a3"],
    logo: ["#ff7b54", "#ff905f", "#ffab66", "#ffc078", "#ffd6a5"],
  },
};

export const InkThemeContext = createContext<InkTheme>(INK_THEMES.signal);

export function getInkTheme(value?: string | InkThemeName): InkTheme {
  const name = parseInkTheme(value) ?? "signal";
  return INK_THEMES[name];
}

export type InkThemeCommandResult =
  | { readonly handled: false }
  | { readonly handled: true; readonly name?: InkThemeName; readonly error?: string };

export function parseInkThemeCommand(value: string): InkThemeCommandResult {
  const trimmed = value.trim();
  const normalized = trimmed.startsWith("/")
    ? `:${trimmed.slice(1)}`
    : trimmed;
  const tokens = normalized.split(/\s+/);
  if (tokens[0]?.toLowerCase() !== ":theme") {
    return { handled: false };
  }
  if (tokens.length === 1) {
    return { handled: true, name: undefined };
  }
  if (tokens.length !== 2) {
    return { handled: true, error: "Usage: :theme [signal|mono|ember]" };
  }
  const name = parseInkTheme(tokens[1]);
  return name === undefined
    ? { handled: true, error: "Usage: :theme [signal|mono|ember]" }
    : { handled: true, name };
}

export function InkThemeProvider({
  theme,
  children,
}: {
  readonly theme: InkTheme;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <InkThemeContext.Provider value={theme}>
      {children}
    </InkThemeContext.Provider>
  );
}

export function useInkTheme(): InkTheme {
  return useContext(InkThemeContext);
}
