import { DEFAULT_COMMAND_HINTS, type CommandHint } from "./tui-renderer.js";
import { displayWidth, fitDisplayLine } from "./tui-width.js";

export type InputKey =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "enter"; readonly shift: boolean }
  | { readonly type: "backspace" }
  | { readonly type: "delete" }
  | { readonly type: "left" | "right" | "up" | "down" | "home" | "end" }
  | { readonly type: "tab" | "escape" | "ctrl-l" | "ctrl-c" };

export interface PaletteState {
  readonly open: boolean;
  readonly matches: readonly CommandHint[];
  readonly selected: number;
}

export interface InputEditorState {
  readonly value: string;
  readonly cursor: number;
  readonly history: readonly string[];
  readonly historyIndex: number;
  readonly palette: PaletteState;
  readonly submitted: boolean;
  readonly submittedValue?: string;
}

const EMPTY_PALETTE: PaletteState = { open: false, matches: [], selected: 0 };

export function createInputEditorState(history: readonly string[] = []): InputEditorState {
  return {
    value: "",
    cursor: 0,
    history: [...history],
    historyIndex: history.length,
    palette: EMPTY_PALETTE,
    submitted: false,
  };
}

function paletteMatches(value: string, commands: readonly CommandHint[]): readonly CommandHint[] {
  const line = value.split("\n").at(-1) ?? "";
  const prefix = line.startsWith(":") ? ":" : line.startsWith("/") ? "/" : "";
  if (!prefix) return [];
  const query = line.slice(1).toLowerCase();
  return commands.flatMap((command) => {
    const name = command.command.replace(/^[:/]/, "").toLowerCase();
    const description = command.description?.toLowerCase() ?? "";
    if (!name.startsWith(query) && !name.includes(query) && !description.includes(query)) return [];
    return [{
      ...command,
      command: `${prefix}${command.command.replace(/^[:/]/, "")}`,
    }];
  });
}

function updatePalette(value: string, commands: readonly CommandHint[]): PaletteState {
  const matches = paletteMatches(value, commands);
  const line = value.split("\n").at(-1) ?? "";
  return {
    open: line.startsWith("/") || line.startsWith(":"),
    matches,
    selected: 0,
  };
}

function replaceCurrentLine(value: string, replacement: string): { value: string; cursor: number } {
  const lineStart = value.lastIndexOf("\n") + 1;
  return { value: `${value.slice(0, lineStart)}${replacement}`, cursor: lineStart + replacement.length };
}

export function reduceInputKey(
  state: InputEditorState,
  key: InputKey,
  commands: readonly CommandHint[] = DEFAULT_COMMAND_HINTS
): InputEditorState {
  if (key.type === "text") {
    const value = `${state.value.slice(0, state.cursor)}${key.value}${state.value.slice(state.cursor)}`;
    return {
      ...state,
      value,
      cursor: state.cursor + key.value.length,
      palette: updatePalette(value, commands),
      submitted: false,
      submittedValue: undefined,
    };
  }

  if (key.type === "enter") {
    if (key.shift) {
      const value = `${state.value.slice(0, state.cursor)}\n${state.value.slice(state.cursor)}`;
      return { ...state, value, cursor: state.cursor + 1, palette: updatePalette(value, commands) };
    }
    if (state.palette.open && state.palette.matches.length > 0) {
      const selected = state.palette.matches[state.palette.selected] ?? state.palette.matches[0];
      if (selected) {
        const replacement = replaceCurrentLine(state.value, selected.command);
        return { ...state, ...replacement, palette: updatePalette(replacement.value, commands) };
      }
    }
    return { ...state, submitted: true, submittedValue: state.value, palette: EMPTY_PALETTE };
  }

  if (key.type === "tab" && state.palette.open && state.palette.matches.length > 0) {
    const selected = state.palette.matches[state.palette.selected] ?? state.palette.matches[0];
    if (!selected) return state;
    const replacement = replaceCurrentLine(state.value, selected.command);
    return { ...state, ...replacement, palette: updatePalette(replacement.value, commands) };
  }

  if (key.type === "escape") return { ...state, palette: EMPTY_PALETTE };
  if (key.type === "left") return { ...state, cursor: Math.max(0, state.cursor - 1) };
  if (key.type === "right") return { ...state, cursor: Math.min(state.value.length, state.cursor + 1) };
  if (key.type === "home") {
    const lineStart = state.value.lastIndexOf("\n", state.cursor - 1) + 1;
    return { ...state, cursor: lineStart };
  }
  if (key.type === "end") {
    const lineEnd = state.value.indexOf("\n", state.cursor);
    return { ...state, cursor: lineEnd < 0 ? state.value.length : lineEnd };
  }
  if (key.type === "backspace" && state.cursor > 0) {
    const value = `${state.value.slice(0, state.cursor - 1)}${state.value.slice(state.cursor)}`;
    return { ...state, value, cursor: state.cursor - 1, palette: updatePalette(value, commands) };
  }
  if (key.type === "delete" && state.cursor < state.value.length) {
    const value = `${state.value.slice(0, state.cursor)}${state.value.slice(state.cursor + 1)}`;
    return { ...state, value, palette: updatePalette(value, commands) };
  }
  if (key.type === "up" || key.type === "down") {
    if (state.palette.open && state.palette.matches.length > 0) {
      const delta = key.type === "up" ? -1 : 1;
      const selected = (state.palette.selected + delta + state.palette.matches.length) % state.palette.matches.length;
      return { ...state, palette: { ...state.palette, selected } };
    }
    const nextIndex = key.type === "up"
      ? Math.max(0, state.historyIndex - 1)
      : Math.min(state.history.length, state.historyIndex + 1);
    const value = state.history[nextIndex] ?? "";
    return { ...state, value, cursor: value.length, historyIndex: nextIndex };
  }
  return state;
}

export function renderInputEditor(state: InputEditorState, width: number): string[] {
  const safeWidth = Math.max(20, Math.floor(width));
  const contentWidth = safeWidth - 4;
  const lines = state.value.split("\n").flatMap((line) => {
    if (displayWidth(line) <= contentWidth) return [line];
    const output: string[] = [];
    let remaining = line;
    while (displayWidth(remaining) > contentWidth) {
      let cut = 0;
      let currentWidth = 0;
      for (const character of remaining) {
        const characterWidth = displayWidth(character);
        if (currentWidth + characterWidth > contentWidth) break;
        currentWidth += characterWidth;
        cut += character.length;
      }
      output.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut);
    }
    output.push(remaining);
    return output;
  });
  const visibleLines = lines.length > 0 ? lines : [""];
  const rendered = [
    `╭${"─".repeat(safeWidth - 2)}╮`,
    ...visibleLines.map((line, index) => fitDisplayLine(`│ ${index === 0 ? "› " : "  "}${line}`, safeWidth - 1) + "│"),
  ];
  if (state.palette.open && state.palette.matches.length > 0) {
    rendered.push(`├${"─".repeat(safeWidth - 2)}┤`);
    for (const [index, command] of state.palette.matches.slice(0, 5).entries()) {
      const marker = index === state.palette.selected ? "›" : " ";
      rendered.push(fitDisplayLine(`│ ${marker} ${command.command}  ${command.description ?? ""}`, safeWidth - 1) + "│");
    }
  }
  rendered.push(`╰${"─".repeat(safeWidth - 2)}╯`);
  return rendered;
}

export interface RichInputControllerOptions {
  readonly input: NodeJS.ReadableStream & {
    isTTY?: boolean;
    setRawMode?: (value: boolean) => void;
    pause?: () => void;
    resume?: () => void;
  };
  readonly output: NodeJS.WritableStream;
  readonly width: () => number;
  readonly history?: readonly string[];
  readonly commands: readonly CommandHint[];
}

export class RichInputController {
  private state: InputEditorState;
  private rawModeEnabled = false;
  private renderedLineCount = 0;
  private waiting:
    | { resolve: (value: string | null) => void; reject: (error: Error) => void }
    | undefined;
  private readonly onData = (chunk: Buffer | string): void => {
    for (const key of parseInputKeys(chunk.toString())) {
      this.handleKey(key);
    }
  };
  private readonly onEnd = (): void => {
    this.resolveRead(null);
  };

  constructor(private readonly options: RichInputControllerOptions) {
    this.state = createInputEditorState(options.history);
  }

  async read(): Promise<string | null> {
    if (this.waiting) throw new Error("rich input editor already has a pending read");
    this.options.input.resume?.();
    this.options.input.on("data", this.onData);
    this.options.input.once("end", this.onEnd);
    this.setRawMode(true);
    const result = new Promise<string | null>((resolve, reject) => {
      this.waiting = { resolve, reject };
    });
    this.redraw();
    return await result;
  }

  close(): void {
    this.options.input.off("data", this.onData);
    this.options.input.off("end", this.onEnd);
    this.setRawMode(false);
    this.options.input.pause?.();
    this.resolveRead(null);
  }

  redraw(): void {
    if (this.renderedLineCount > 0) {
      this.options.output.write(clearRenderedBlock(this.renderedLineCount));
    }
    const lines = renderInputEditor(this.state, this.options.width());
    this.options.output.write(`${lines.join("\n")}\n`);
    this.renderedLineCount = lines.length;
  }

  private handleKey(key: InputKey): void {
    if (key.type === "ctrl-c") {
      this.clearRendered();
      this.resolveRead(null);
      return;
    }
    if (key.type === "ctrl-l") {
      this.options.output.write("\u001b[2J\u001b[H");
      this.renderedLineCount = 0;
      this.redraw();
      return;
    }
    this.state = reduceInputKey(this.state, key, this.options.commands);
    if (this.state.submitted) {
      const value = this.state.submittedValue ?? "";
      const history = value.trim().length === 0
        ? this.state.history
        : [...this.state.history, value];
      this.state = createInputEditorState(history);
      this.renderedLineCount = 0;
      this.options.input.off("data", this.onData);
      this.options.input.off("end", this.onEnd);
      this.setRawMode(false);
      this.options.input.pause?.();
      this.resolveRead(value);
      return;
    }
    this.redraw();
  }

  private clearRendered(): void {
    if (this.renderedLineCount === 0) return;
    this.options.output.write(clearRenderedBlock(this.renderedLineCount));
    this.renderedLineCount = 0;
  }

  private resolveRead(value: string | null): void {
    const pending = this.waiting;
    if (!pending) return;
    this.waiting = undefined;
    pending.resolve(value);
  }

  private setRawMode(enabled: boolean): void {
    if (this.rawModeEnabled === enabled) return;
    this.rawModeEnabled = enabled;
    this.options.input.setRawMode?.(enabled);
  }
}

function parseInputKeys(value: string): InputKey[] {
  const keys: InputKey[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (value.startsWith("\u001b[13;2u", index)) {
      keys.push({ type: "enter", shift: true });
      index += 6;
    } else if (value.startsWith("\u001b[27;2;13~", index)) {
      keys.push({ type: "enter", shift: true });
      index += 9;
    } else if (value.startsWith("\u001b\r", index)) {
      keys.push({ type: "enter", shift: true });
      index += 1;
    } else if (value.startsWith("\u001b[200~", index)) {
      const end = value.indexOf("\u001b[201~", index + 6);
      const pasted = end < 0 ? value.slice(index + 6) : value.slice(index + 6, end);
      if (pasted) keys.push({ type: "text", value: pasted });
      if (end >= 0) index = end + 5;
      else index = value.length;
    } else if (value.startsWith("\u001b[A", index)) {
      keys.push({ type: "up" });
      index += 2;
    } else if (value.startsWith("\u001b[B", index)) {
      keys.push({ type: "down" });
      index += 2;
    } else if (value.startsWith("\u001b[C", index)) {
      keys.push({ type: "right" });
      index += 2;
    } else if (value.startsWith("\u001b[D", index)) {
      keys.push({ type: "left" });
      index += 2;
    } else if (value.startsWith("\u001b[H", index)) {
      keys.push({ type: "home" });
      index += 2;
    } else if (value.startsWith("\u001b[1~", index)) {
      keys.push({ type: "home" });
      index += 3;
    } else if (value.startsWith("\u001b[F", index)) {
      keys.push({ type: "end" });
      index += 2;
    } else if (value.startsWith("\u001b[4~", index)) {
      keys.push({ type: "end" });
      index += 3;
    } else if (value.startsWith("\u001b[3~", index)) {
      keys.push({ type: "delete" });
      index += 3;
    } else if (value[index] === "\u001b") {
      keys.push({ type: "escape" });
    } else if (character === "\r" || character === "\n") {
      keys.push({ type: "enter", shift: false });
    } else if (character === "\t") {
      keys.push({ type: "tab" });
    } else if (character === "\u0003") {
      keys.push({ type: "ctrl-c" });
    } else if (character === "\u000c") {
      keys.push({ type: "ctrl-l" });
    } else if (character === "\u007f") {
      keys.push({ type: "backspace" });
    } else if (character !== undefined && character >= " ") {
      keys.push({ type: "text", value: character });
    }
  }
  return keys;
}

function clearRenderedBlock(lineCount: number): string {
  if (lineCount <= 0) return "";

  const chunks = [`\u001b[${lineCount}A`];
  for (let index = 0; index < lineCount; index += 1) {
    chunks.push("\u001b[2K\r");
    if (index < lineCount - 1) chunks.push("\n");
  }
  if (lineCount > 1) chunks.push(`\u001b[${lineCount - 1}A`);
  return chunks.join("");
}
