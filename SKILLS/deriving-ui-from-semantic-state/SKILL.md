---
name: deriving-ui-from-semantic-state
description: Use when a UI card, status, label, or validation result becomes stale after state, locale, theme, selection, or asynchronous request changes.
---

# Deriving UI from Semantic State

## Overview

Rendered text and cards are projections, not the source of truth. Store
semantic state and derive the visible result from that state plus every current
presentation dependency.

## Core Pattern

1. **Store meaning, not presentation.** Keep stable IDs, enum statuses,
   booleans, raw values, timestamps, and request/session identifiers. Do not
   make translated labels, HTML, CSS classes, or formatted sentences the
   authoritative state.
2. **Render from current inputs.** Derive labels, colors, actions, counts, and
   accessibility text from the current semantic state, locale, theme,
   permissions, and selection each time the view is rendered.
3. **Declare invalidation dependencies.** A state transition, locale/theme
   change, session switch, or current request change must cause the affected
   projection to be recomputed. A redraw that reuses stale display data is not
   a fix.
4. **Reject stale asynchronous results.** Associate each request with its
   session or version. Check that identity before updating semantic state or
   rendering; a late result must not mutate the current view.
5. **Separate app-owned and user-owned text.** Re-derive app labels and
   statuses; preserve user-entered or provider content unless the product
   explicitly translates it.

## Quick Reference

| Change | Recompute |
|---|---|
| Status or validation result | Card state, label, actions, and styling |
| Locale or language | Labels, messages, and accessible names |
| Theme or contrast mode | Presentation tokens, not semantic status |
| Session, selection, or request version | Data-bound content and actions |
| Late async completion | Only if its identity is still current |

## Example

```ts
const copy = { en: { "run.success": "Succeeded" } };
const translate = (locale, key) => copy[locale][key];
const toneFor = (status) => status === "success" ? "positive" : "neutral";

function runCard(run, locale) {
  return {
    label: translate(locale, `run.${run.status}`),
    tone: toneFor(run.status),
    action: run.canUndo ? "undo" : null,
  };
}

console.log(runCard({ status: "success", canUndo: true }, "en"));
```

The semantic `status` and `canUndo` remain stable while the projection changes
with `currentLocale`.

## Verification Matrix

- Change semantic state before rendering and assert the new card.
- Change locale without changing state and assert every app-owned string.
- Resolve an old request after a session switch and assert no visible mutation.
- Re-render the same state under two locales and compare only the projection.
- Counterexample: keep user-entered text unchanged unless translation is an
  explicit product requirement.

## Common Mistakes

- Caching `statusLabel` or translated sentences in state.
- Updating a card only in the event handler that first created it.
- Treating a redraw as sufficient when the underlying projection is stale.
- Letting a late promise update the active session without an identity check.

**REQUIRED BACKGROUND:** Use `superpowers:test-driven-development` when
changing the implementation.
