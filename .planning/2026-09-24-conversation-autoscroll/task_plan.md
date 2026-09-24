# Desktop conversation auto-scroll plan

## Objective

Fix the middle conversation panel so streaming assistant output stays visible and
pushes older content upward inside the message viewport, while the composer
remains anchored at the bottom. Preserve intentional manual scrolling and the
existing "new output below" affordance.

## Phases

- [x] Phase 1: inspect the conversation DOM/CSS and reproduce the layout/scroll bug.
- [x] Phase 2: implement a bounded flex/overflow and streaming follow-latest fix.
- [x] Phase 3: add focused contract/browser regression coverage.
- [ ] Phase 4: run verification, review the diff, commit, and push the fix.

## Constraints

- Keep the composer outside the scrollable message list and visible at the bottom.
- Auto-follow only while the user is at/near the latest output; do not steal the
  viewport after the user scrolls upward.
- Keep the existing session, approval, streaming, and safety behavior unchanged.
- Preserve unrelated untracked planning/playwright/output artifacts.


## Current evidence

- Browser reproduction and fresh-server acceptance completed on 2026-09-24.
- Desktop full suite: 236/236 passed after the fix.
- Final build/typecheck, diff review, commit, and GitHub push remain before closing this focused fix.
