import { useEffect, useRef } from "react";

// All decorative TUI animations (status line, thinking glyph, thought line,
// command palette, approval pulse) used to run their own setInterval. One
// shared 180ms ticker replaces them: a single OS timer no matter how many
// components animate, and every animation advances on the same clock. The
// timer starts lazily on the first subscriber and stops when the last leaves.
const TICK_MS = 180;

export const ANIMATION_TICK_MS = TICK_MS;

type TickSubscriber = (tick: number) => void;

const subscribers = new Set<TickSubscriber>();
let timer: ReturnType<typeof setInterval> | undefined;
let tick = 0;

function ensureTimer(): void {
  if (timer !== undefined || subscribers.size === 0) return;
  tick = 0;
  timer = setInterval(() => {
    tick += 1;
    for (const subscriber of [...subscribers]) {
      if (subscribers.has(subscriber)) subscriber(tick);
    }
  }, TICK_MS);
  timer.unref?.();
}

function maybeStopTimer(): void {
  if (subscribers.size === 0 && timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
}

export function subscribeToAnimationClock(subscriber: TickSubscriber): () => void {
  // Each subscription owns a distinct entry, even for the same callback.
  const entry: TickSubscriber = (value) => subscriber(value);
  subscribers.add(entry);
  ensureTimer();
  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    subscribers.delete(entry);
    maybeStopTimer();
  };
}

/**
 * Invokes `onTick` with a subscription-local count on shared 180ms ticks.
 * Changing resetKey restarts the local count without restarting other users.
 * The callback lives in a ref, so callers may pass inline closures without
 * resubscribing on every render.
 */
export function useAnimationTicks(onTick: TickSubscriber, active: boolean, resetKey?: string): void {
  const callbackRef = useRef(onTick);
  useEffect(() => {
    callbackRef.current = onTick;
  }, [onTick]);
  useEffect(() => {
    if (!active) return;
    let localTick = 0;
    return subscribeToAnimationClock(() => callbackRef.current(++localTick));
  }, [active, resetKey]);
}
