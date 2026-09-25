# Findings — Real PTY Sticky CLI Verification and Fix

## Initial hypothesis

The previous implementation moved the navigation label to the dynamic shell and
added a header, but it was verified mostly through Ink test output. The user
reports that the real terminal does not scroll the content and that the prompt
is not fixed at the top, so the next step must use a real PTY and inspect actual
terminal frames rather than infer behavior from render-to-string output.

## Preservation boundary

The worktree contains unrelated staged and unstaged Desktop/MCP/Validation
changes. Only CLI files and this plan may be changed or committed for this
tranche.

## Real PTY evidence — 2026-09-25

- Launched `pnpm --filter @agent_cli/cli start` in a real PTY and opened the
  terminal session in the Codex terminal panel.
- Submitted a Chinese prompt asking for 18 output lines, then sent PageUp.
- The CLI reported `11 rows above · 7 rows below`, but the visible frame still
  rendered all 18 response lines. This proves the viewport model moved while
  the renderer failed to clip an intersecting oversized `TranscriptEntry`.
- Root cause is the `TranscriptViewport` height guard: it only applied
  `height/overflow=hidden` when the selected item rows were already within the
  viewport budget. A single Markdown entry larger than the viewport therefore
  bypassed clipping entirely.
- The real PTY also confirmed the bottom status/composer/footer remain in the
  dynamic shell; the missing behavior is transcript clipping and clearer task
  header separation, not input focus.

## Post-fix evidence — 2026-09-25

- Fixed output from the real PTY now shows only the latest response tail at the
  bottom, rather than expanding the whole response above the composer.
- PageUp produced a bounded frame containing rows 8–15; the prompt/title stayed
  on the first dynamic row and the bottom navigation/status/composer/footer did
  not move.
- An SGR mouse-wheel packet (`ESC [<64;12;8M`) moved the same live session to a
  different slice (rows 5–12), confirming actual mouse scrolling rather than a
  test-only state transition.
