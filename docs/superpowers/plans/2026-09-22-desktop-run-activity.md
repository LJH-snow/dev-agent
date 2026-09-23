# Desktop Run Activity Indicators

## Goal

Make the current agent run legible without exposing hidden chain-of-thought.
Each visible turn should communicate its safe runtime stage while the response
is streaming.

## Scope

- Show localized stages for queued, thinking, tool use, response generation,
  approval, complete, failed, aborted, and removed.
- Derive stages from existing SSE event types and bounded run-replay data.
- Keep stage state owned by the turn so session switching cannot cross-wire it.
- Refresh stage labels when the language toggle changes.
- Keep terminal states authoritative over stale replay fragments.

## Out Of Scope

- No new server event types or provider changes.
- No exposure of hidden model chain-of-thought beyond the existing
  model-provided reasoning event rendering.
- No persistence of transient activity labels.

## Verification

- Unit-test event and lifecycle mapping, including fail-closed defaults.
- Verify the Desktop HTML contract.
- Run the complete Desktop suite.
- Use a browser smoke with a delayed SSE stream to verify stage transitions,
  language switching, terminal cleanup, and console cleanliness.
