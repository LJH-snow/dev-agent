export type MouseWheelDirection = "up" | "down";
export type MouseClickAction = "press" | "release";

export interface MouseClick {
  /** The protocol button code, including modifier/motion bits. */
  readonly button: number;
  /** One-based terminal column. */
  readonly x: number;
  /** One-based terminal row. */
  readonly y: number;
  readonly action: MouseClickAction;
}

export interface MouseMove {
  /** One-based terminal column. */
  readonly x: number;
  /** One-based terminal row. */
  readonly y: number;
}

export interface MouseInputParseResult {
  readonly consumed: boolean;
  readonly directions: readonly MouseWheelDirection[];
  readonly clicks: readonly MouseClick[];
  readonly moves: readonly MouseMove[];
  /** Non-mouse text from the same input event, if any. */
  readonly remaining: string;
}

/**
 * Filters terminal mouse reports from Ink's key input while retaining wheel
 * direction events for transcript navigation. X10 reports are split by Ink's
 * CSI parser into the `ESC[M` prefix and the following three payload bytes, so
 * this parser keeps that small amount of state across input events.
 */
export class MouseInputParser {
  private pendingX10Payload: string | undefined;

  push(input: string): MouseInputParseResult {
    const directions: MouseWheelDirection[] = [];
    const clicks: MouseClick[] = [];
    const moves: MouseMove[] = [];
    let consumed = false;
    let remaining = "";
    let index = 0;

    while (index < input.length) {
      if (this.pendingX10Payload !== undefined) {
        const pendingLength = Array.from(this.pendingX10Payload).length;
        const characters = Array.from(input.slice(index));
        const takeCount = Math.min(3 - pendingLength, characters.length);
        const payload = characters.slice(0, takeCount).join("");
        this.pendingX10Payload += payload;
        index += payload.length;
        consumed = true;

        if (Array.from(this.pendingX10Payload).length < 3) {
          break;
        }

        const [buttonByte, xByte, yByte] = Array.from(this.pendingX10Payload).map(
          (character) => character.charCodeAt(0),
        );
        const buttonCode = (buttonByte ?? 0) - 32;
        const x = (xByte ?? 0) - 32;
        const y = (yByte ?? 0) - 32;
        if (buttonCode >= 0 && (buttonCode & 64) !== 0) {
          directions.push((buttonCode & 1) === 0 ? "up" : "down");
        } else if (
          buttonCode >= 0 &&
          Number.isSafeInteger(x) &&
          Number.isSafeInteger(y) &&
          x > 0 &&
          y > 0
        ) {
          if ((buttonCode & 32) !== 0) {
            moves.push({ x, y });
          } else {
            clicks.push({
              button: buttonCode,
              x,
              y,
              action: (buttonCode & 3) === 3 ? "release" : "press",
            });
          }
        }
        this.pendingX10Payload = undefined;
        continue;
      }

      const sgrMatch = /^(?:\u001b)?\[<(\d+);(\d+);(\d+)([Mm])/.exec(
        input.slice(index),
      );
      if (sgrMatch) {
        const button = Number(sgrMatch[1]);
        const x = Number(sgrMatch[2]);
        const y = Number(sgrMatch[3]);
        if (Number.isSafeInteger(button) && (button & 64) !== 0) {
          directions.push((button & 1) === 0 ? "up" : "down");
        } else if (
          Number.isSafeInteger(button) &&
          Number.isSafeInteger(x) &&
          Number.isSafeInteger(y) &&
          x > 0 &&
          y > 0
        ) {
          if ((button & 32) !== 0) {
            moves.push({ x, y });
          } else {
            clicks.push({
              button,
              x,
              y,
              action: sgrMatch[4] === "M" ? "press" : "release",
            });
          }
        }
        consumed = true;
        index += sgrMatch[0].length;
        continue;
      }

      const x10Prefix = input.startsWith("\u001b[M", index)
        ? 3
        : input.startsWith("[M", index)
          ? 2
          : 0;
      if (x10Prefix > 0) {
        this.pendingX10Payload = "";
        consumed = true;
        index += x10Prefix;
        continue;
      }

      const codePoint = input.codePointAt(index);
      if (codePoint === undefined) break;
      const character = String.fromCodePoint(codePoint);
      remaining += character;
      index += character.length;
    }

    return { consumed, directions, clicks, moves, remaining };
  }
}

// 1003 reports pointer movement without requiring a button to be held; 1006
// keeps coordinates in the SGR format so modern terminals can report rows and
// columns larger than the legacy X10 byte range.
export const MOUSE_TRACKING_ENABLE = "\u001b[?1003h\u001b[?1006h";
export const MOUSE_TRACKING_DISABLE = "\u001b[?1006l\u001b[?1003l";

/**
 * Parses the two mouse protocols commonly emitted by macOS Terminal and
 * iTerm2. Ink's input pipeline may pass the sequence to useInput with its
 * leading ESC byte removed, so both forms are accepted without treating a
 * wheel event as prompt text.
 */
export function mouseWheelDirections(input: string): MouseWheelDirection[] {
  return [...new MouseInputParser().push(input).directions];
}
