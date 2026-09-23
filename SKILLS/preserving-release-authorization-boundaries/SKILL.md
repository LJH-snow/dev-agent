---
name: preserving-release-authorization-boundaries
description: Use when a task includes distinct release side effects—such as package publishing, tag pushes, GitHub Releases, or deployment—and the user has authorized only some steps or replies with a vague continuation.
---

# Preserving Release Authorization Boundaries

## Principle

Authorization applies to the action, version, and destination the user actually approved. Preparing or approving one release step does not automatically authorize adjacent external actions.

## Before Each External Release Action

1. Name the exact action, version, and destination you are about to affect.
2. Check whether the user's explicit instruction, read in its immediate context, clearly covers all three. An assistant's prior announcement, broad “keep working” request, successful preflight, available credentials, or vague “continue” does not expand authorization.
3. If the action is outside or ambiguous in the approved scope, do safe read-only preparation only. State what is complete, name the new side effect (for example, pushing a tag will trigger a public GitHub Release workflow), and ask for explicit confirmation before running it.
4. After confirmation, perform only the authorized action and verify it. Do not chain another destination or publication step unless the user's instruction covers it too.

An explicit instruction to complete a named formal release, including its tag push and resulting GitHub Release, covers those named steps. Do not ask again for steps already clearly authorized.

## Common Rationalizations

| Temptation | Reality |
|---|---|
| “The user said ‘continue’ after I explained the release was unfinished.” | A status update does not grant new authorization. |
| “The npm package is live, so the GitHub tag is just the next release step.” | npm publishing and a tag-triggered GitHub Release affect different destinations. |
| “The work window is ending and every check passed.” | Time pressure and readiness do not change the approved scope. |

## Boundary Check

- “Publish package `0.1.8`” in an npm-publishing context authorizes that package publication, not an unmentioned Git tag or GitHub Release.
- “Push tag `v0.1.8` to trigger the formal GitHub Release” explicitly names that external action.
- If the user only says “continue” after a separate action is identified as pending, hold that action and ask one precise confirmation.
