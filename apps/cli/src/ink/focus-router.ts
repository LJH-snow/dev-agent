import { useEffect } from "react";
import { useFocus, useFocusManager } from "ink";

export const INK_FOCUS_IDS = {
  prompt: "ink-prompt",
  sessionPicker: "ink-session-picker",
  pathCompletion: "ink-path-completion",
  commandPalette: "ink-command-palette",
  retry: "ink-retry",
  composer: "ink-composer",
} as const;

export type InkFocusOwner = keyof typeof INK_FOCUS_IDS;

export interface InkFocusState {
  readonly activeInputPrompt: boolean;
  readonly sessionPicker: boolean;
  readonly pathCompletion: boolean;
  readonly commandPalette: boolean;
  readonly retry: boolean;
}

export function resolveInkFocusOwner(state: InkFocusState): InkFocusOwner {
  if (state.activeInputPrompt) return "prompt";
  if (state.sessionPicker) return "sessionPicker";
  if (state.pathCompletion) return "pathCompletion";
  if (state.commandPalette) return "commandPalette";
  if (state.retry) return "retry";
  return "composer";
}

export function useInkFocusRouter(state: InkFocusState): {
  readonly owner: InkFocusOwner;
  readonly activeId?: string;
} {
  const owner = resolveInkFocusOwner(state);
  const { activeId, focus } = useFocusManager();

  // Keep every mode registered so Ink's Tab traversal remains deterministic,
  // while activating exactly one owner for the current modal state. The
  // composer is the initial owner when the app has no modal surface open.
  useFocus({
    id: INK_FOCUS_IDS.prompt,
    isActive: owner === "prompt",
  });
  useFocus({
    id: INK_FOCUS_IDS.sessionPicker,
    isActive: owner === "sessionPicker",
  });
  useFocus({
    id: INK_FOCUS_IDS.pathCompletion,
    isActive: owner === "pathCompletion",
  });
  useFocus({
    id: INK_FOCUS_IDS.commandPalette,
    isActive: owner === "commandPalette",
  });
  useFocus({
    id: INK_FOCUS_IDS.retry,
    isActive: owner === "retry",
  });
  useFocus({
    id: INK_FOCUS_IDS.composer,
    isActive: owner === "composer",
    autoFocus: true,
  });

  const desiredId = INK_FOCUS_IDS[owner];
  useEffect(() => {
    if (activeId !== desiredId) {
      focus(desiredId);
    }
  }, [activeId, desiredId, focus]);

  return { owner, activeId };
}
