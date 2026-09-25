# Findings

- The existing navigation label was rendered in a shrink-wrapped `Box` with `paddingX=1`, so it stayed at the left edge. The hitbox also always started at column 2, even after the label was visually moved.
- The fixed bottom shell is rendered through `createInkRenderOutput`, which adds one virtual guard row for Ink. In the real guarded layout, the visible navigation row is one cell above the previous hit-test row; using `terminalRows - 8` matches the visible row in the PTY-style fixture.
- The old integration test used `(x=12, y=17)` and therefore did not reproduce the user's actual centered visual target. The new regression uses the centered `(x=40, y=16)` coordinate for an 80x24 terminal and explicitly rejects the row below.
- The click handler already called `viewportModel.end()`. The apparent no-op was caused by the wrong row hit test; after aligning the row, the click test observes the latest `click-line-40` and the navigation prompt disappears.
