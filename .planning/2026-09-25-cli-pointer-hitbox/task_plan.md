# CLI pointer hitbox repair

## Goal
The centered Back to bottom label must highlight only at its visible terminal cells. Moving to adjacent rows/columns removes highlight; clicking the visible label returns to the latest transcript.

## Phases
1. [complete] Reproduce against a terminal screen (real ANSI cursor movement, not concatenated debug strings); identify actual painted coordinates and mouse state flow.
2. [complete] Add failing regression coverage for visible-cell hover/leave/click at 80×24, 120×40, and 160×50.
3. [complete] Correct the physical row calculation based on observed Ink output. Keep centered label and transcript logic unchanged.
4. [complete] Verify focused suites, build, clean diff, and commit only this task's files.

## Constraints
- Preserve unrelated ongoing CLI/Desktop/core changes.
- No guessed offset adjustment or duplicate mouse listeners without evidence.
- Do not claim physical mouse testing when injecting terminal events.
