// Ink may intercept stderr and restore/re-render its frame on writes. Never
// perform I/O from onRender: keep constant-space counters until after unmount.
export const RENDER_METRICS_SLOW_FRAME_MS = 1000 / 15;

export function renderMetricsEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.DEV_AGENT_TUI_RENDER_METRICS === "1";
}

export function createRenderMetricsLifecycle(
  onInitialRender: () => void,
  enabled = renderMetricsEnabled(),
  write: (message: string) => void = (message) => { process.stderr.write(message); },
): {
  onRender: (metrics: { renderTime: number }) => void;
  unmount: (unmount: () => void) => void;
} {
  let initialized = false;
  let finished = false;
  let slowFrames = 0;
  let maxMs = 0;
  return {
    onRender({ renderTime }) {
      if (finished) return;
      if (!initialized) {
        initialized = true;
        onInitialRender();
      }
      if (!enabled || !Number.isFinite(renderTime) || renderTime <= RENDER_METRICS_SLOW_FRAME_MS) return;
      slowFrames = Math.min(Number.MAX_SAFE_INTEGER, slowFrames + 1);
      maxMs = Math.max(maxMs, renderTime);
    },
    unmount(unmount) {
      if (finished) return;
      // Include Ink's final render, then emit only after its console restoration.
      // If unmount throws, do not write into a possibly still-owned terminal.
      unmount();
      finished = true;
      if (slowFrames === 0) return;
      try {
        write(`[tui-render] slow frames: ${slowFrames}; max: ${maxMs.toFixed(1)}ms; budget: ${RENDER_METRICS_SLOW_FRAME_MS.toFixed(2)}ms\n`);
      } catch {
        // Optional diagnostics must not prevent session cleanup.
      }
    },
  };
}
