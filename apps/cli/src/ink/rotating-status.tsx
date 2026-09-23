import { useEffect, useState } from "react";
import { Text } from "ink";

import type { TuiRunState } from "../tui-session.js";

export const ROTATING_STATUS_FRAMES = [
  "THINKING",
  "PLANNING NEXT STEP",
  "READING CONTEXT",
  "CHECKING CONSTRAINTS",
] as const;

const STATE_FRAMES: Readonly<Record<TuiRunState, readonly string[]>> = {
  ready: ["READY", "IDLE"],
  thinking: ROTATING_STATUS_FRAMES,
  streaming: ["STREAMING", "SHAPING RESPONSE", "WRITING RESPONSE", "POLISHING ANSWER"],
  "tool-running": ["TOOL RUNNING", "CALLING TOOL", "CHECKING TOOL RESULT", "FOLLOWING OUTPUT"],
  "waiting-approval": ["WAITING FOR APPROVAL", "REVIEW REQUIRED", "READY FOR YOUR DECISION"],
  validating: ["VALIDATING", "RUNNING TRUSTED CHECKS", "VERIFYING CHANGES"],
  done: ["DONE", "RUN COMPLETE"],
  error: ["ERROR", "RUN FAILED"],
  interrupted: ["INTERRUPTED", "RUN STOPPED"],
};

export function rotatingStatusFrames(
  state: TuiRunState,
  steps: readonly string[],
): readonly string[] {
  const base = STATE_FRAMES[state] ?? ROTATING_STATUS_FRAMES;
  const latest = normalizeStatusText(steps.at(-1));
  if (!latest || latest === base[0]) {
    return base;
  }
  return [base[0] ?? "WORKING", latest, ...base.slice(1)];
}

export function rotatingStatusFrame(
  index: number,
  state: TuiRunState,
  steps: readonly string[],
): string {
  const frames = rotatingStatusFrames(state, steps);
  const normalized = ((index % frames.length) + frames.length) % frames.length;
  return frames[normalized] ?? frames[0] ?? "WORKING";
}

export function RotatingStatus({
  active,
  state,
  steps,
  frameIndex: controlledFrameIndex,
}: {
  readonly active: boolean;
  readonly state: TuiRunState;
  readonly steps: readonly string[];
  readonly frameIndex?: number;
}): React.JSX.Element {
  const [frameIndex, setFrameIndex] = useState(0);
  const frame = active
    ? rotatingStatusFrame(
      controlledFrameIndex ?? frameIndex,
      state,
      steps,
    )
    : staticStatusLabel(state);

  useEffect(() => {
    setFrameIndex(0);
    if (!active || controlledFrameIndex !== undefined) {
      return;
    }
    const timer = setInterval(() => {
      setFrameIndex((current) => current + 1);
    }, 360);
    return () => clearInterval(timer);
  }, [active, controlledFrameIndex, state, steps.join("\u0000")]);

  return <Text>{frame}</Text>;
}

function staticStatusLabel(state: TuiRunState): string {
  return STATE_FRAMES[state]?.[0] ?? state.toUpperCase();
}

function normalizeStatusText(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length > 48
    ? `${normalized.slice(0, 45)}…`
    : normalized.toUpperCase();
}
