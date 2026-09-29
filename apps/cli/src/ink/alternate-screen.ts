// Alternate (secondary) screen buffer support. The terminal keeps two
// buffers: the normal one with the user's scrollback, and a private
// full-screen one used by programs like vim or htop. Switching to it lets a
// full-screen TUI paint every row without pushing the session transcript into
// the user's scrollback; leaving it restores the previous screen exactly.
//
// Ink 6.8 has no render option for this, so the CLI drives the sequences
// around the Ink instance. CSI ?1049h saves the cursor position and switches
// to the alternate buffer; CSI ?1049l switches back and restores the cursor.
export const ENTER_ALTERNATE_SCREEN = "\u001B[?1049h";
export const EXIT_ALTERNATE_SCREEN = "\u001B[?1049l";

export function alternateScreenEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.DEV_AGENT_TUI_ALT_SCREEN === "1";
}

export interface AlternateScreenSession {
  enter: () => void;
  exit: () => void;
}

/**
 * Enters the alternate screen once and guarantees it is left again: `exit`
 * is idempotent, and a `process exit` hook covers abrupt termination paths
 * (uncaught errors, signals) that bypass the normal close handler.
 * The `exit` hook must be synchronous — stdout writes to a TTY are.
 */
export function createAlternateScreenSession(
  write: (data: string) => void,
  enabled = alternateScreenEnabled(),
): AlternateScreenSession {
  let active = false;
  const restoreOnExit = (): void => {
    if (!active) return;
    active = false;
    try {
      write(EXIT_ALTERNATE_SCREEN);
    } catch {
      // The stream may already be destroyed during process exit.
    }
  };
  return {
    enter() {
      if (!enabled || active) return;
      try {
        write(ENTER_ALTERNATE_SCREEN);
      } catch {
        return;
      }
      active = true;
      process.once("exit", restoreOnExit);
    },
    exit() {
      if (!active) return;
      active = false;
      process.removeListener("exit", restoreOnExit);
      try {
        write(EXIT_ALTERNATE_SCREEN);
      } catch {
        // Restoration is best-effort; never block session cleanup.
      }
    },
  };
}
