# Progress

- Reproduced exact off-by-one misalignment at three terminal sizes with real ANSI rendering and SGR mouse reports.
- Added test dependency `@xterm/headless` for screen-level regressions. Red: 6/6 screen tests failed on old calculation. Green: 6/6 screen tests and 58/58 focused Ink/mouse tests passed on corrected calculation.
- Focused TypeScript compilation succeeded using an isolated tsconfig for modified CLI modules/tests.
- Full CLI build and full CLI test TypeScript compilation now succeed after concurrent changes stabilized. Latest focused Ink/mouse tests: 58 passed, 0 failed.
- Scoped final diff reviewed; commit only the navigation source/tests, headless test dependency, lockfile, and this plan. No physical mouse was automated; SGR input was injected into a headless terminal interpreting the real ANSI output.
