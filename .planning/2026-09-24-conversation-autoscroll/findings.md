# Findings — Desktop conversation auto-scroll

## Initial evidence

- The provided screenshot shows a long streaming assistant response in the middle
  column, with the composer at the bottom. The user reports that newly generated
  content does not make the middle area move upward/follow the latest output.
- Relevant files are `apps/desktop/public/index.html` and
  `apps/desktop/public/styles.css`; the right task terminal has separate output
  follow logic and is not the target surface.

## 2026-09-24 — reproduced and fixed

- Real browser inspection at 1280×900 showed the conversation viewport was at the
  bottom, but `#messages` had `scroll-behavior: smooth`. Repeated direct
  `scrollTop = scrollHeight` updates during streaming therefore animated toward
  stale targets instead of reaching the new bottom immediately; after 550 ms the
  synthetic appended output was still 632 px from the bottom.
- The bounded fix is in `apps/desktop/public/index.html`: the follow-latest path
  now uses `scrollTo({ top, left: 0, behavior: "auto" })` with a safe fallback for
  older/test DOMs. Manual scrolling still sets the pending-output notice and is
  not overridden.
- Browser acceptance on a fresh local server confirmed the new auto-scroll reaches
  the maximum scroll position immediately after appending a large assistant block,
  while the existing manual-scroll contract remains intact.
