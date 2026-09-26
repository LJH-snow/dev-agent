# GitHub PR Review Integration

## Goal
Add a read-only, bounded GitHub pull-request review workspace to the Desktop workbench. Users can load a PR by URL or owner/repo/number, inspect safe metadata and a bounded diff/comment projection, draft local review notes, and insert a review summary into the current prompt. Do not submit remote reviews or comments in this phase.

## Phases
- [x] Inventory current server/UI seams and define bounded projection contract
- [x] Add pure PR input normalization, safe projection, and GitHub CLI adapter with RED tests first
- [x] Add loopback-only POST read route with stable failure classification
- [x] Add bilingual PR Review panel, local draft notes, session isolation, and prompt insertion
- [x] Run focused/full tests and browser acceptance
- [x] Selectively commit and push without staging unrelated parallel work

## Safety and scope
- Read-only remote integration; no GitHub review/comment mutation.
- Explicit opt-in is required for invoking `gh` via `DEV_AGENT_DESKTOP_GITHUB=1`; injected loaders remain available for tests and embedding hosts.
- Never return tokens, environment variables, raw command output, or full commands.
- Bound files, per-file metadata, total diff bytes, comments, local drafts, prompt insertion, and response bytes.
- Loopback-only metadata route; malformed and oversized responses fail closed.
- Remote PR content is rendered with DOM text assignment and inserted into the composer as untrusted reference material.

## Verification evidence
- Focused GitHub PR Review suite: 17/17 passing after the bounded prompt/diff clipping regression fix.
- Full current Desktop suite: 319/319 passing, with Desktop typechecks passing.
- Browser fixture acceptance at `http://127.0.0.1:4319/`: loaded a bounded PR projection, rendered files/reviews/comments/diff, persisted local notes, and inserted review context while switching to Plan mode.
- Browser console only showed the pre-existing task-validation `409 /api/task-validation` fixture response; no PR Review runtime errors occurred.
- The feature-only commit snapshot and final selective-commit audit remain before completion.
