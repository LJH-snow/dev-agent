# Adaptive routing and session model budgets

Continuing the approved CLI feature roadmap. Preserve unrelated Desktop and agent-registry changes.

- [x] Add conservative, local prompt routing (fast greetings, balanced ordinary requests, deep complex work) with explicit manual override.
- [x] Allow only user-configured tier profiles; preserve explicit CLI provider/model/profile selection by default.
- [x] Account per concrete provider request, including fallback and specialist requests; no prompts or outputs in routing/budget state.
- [x] Add process-session cost/token/model-time limits, safe unknown-usage handling, cancellation, and read/update commands.
- [x] Integrate readline, Ink, one-shot, existing hints/config validation and documentation.
- [x] Run focused behavior tests, fake-provider CLI integration, build and typecheck; stage only this feature.

Budget boundary: provider-reported usage is available after a call. Token/cost limits stop subsequent requests and constrain output allowance, but are not a guaranteed billing cap. Unknown accounting must not be presented as zero.
