# Real PTY Sticky CLI Verification and Fix

**Date:** 2026-09-25
**Objective:** Reproduce the CLI scrolling behavior in a real terminal session, compare the visible frame with the attached Codex reference, identify why the current transcript/header placement is not behaving as expected, and refine the Ink layout so the user prompt stays at the top while the actual transcript scrolls and the bottom controls remain fixed.

## Phases

- [x] Launch the built CLI in a real PTY and inspect the actual frame/scroll behavior.
- [x] Use a Codex terminal panel when available and capture concrete evidence of the current failure.
- [x] Fix the smallest authoritative layout/viewport seam; do not replace the existing viewport model blindly.
- [x] Add a regression test that reproduces the real ordering/scroll contract.
- [x] Run focused CLI tests, build/typecheck, and real PTY smoke; review and push only the CLI fix.

## Constraints

- Preserve the user's existing uncommitted Desktop/MCP/Validation work; never reset, clean, checkout, or broad-restore it.
- Do not add remote GitHub mutation or arbitrary terminal/file-write APIs.
- Keep prompts and transcript rendering bounded and text-safe.
- The attached image is a visual reference, not an instruction document.
