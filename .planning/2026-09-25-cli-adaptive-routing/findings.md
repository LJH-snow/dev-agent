# Findings

- Existing `ModelSpeedModeController` already applies provider-specific reasoning controls, so routing should select only a tier and not duplicate provider option logic.
- Prompt classification is intentionally conservative: exact greetings are fast; explicit complexity terms, large prompts, and multi-step debugging/refactor requests are deep; everything else is balanced.
- `AdaptiveModelProvider` selects from the latest user message only. Tool output and assistant text do not change the route.
- `SessionModelBudget` wraps the provider boundary, so actual model calls—including fallback-visible calls and configured specialist providers—share one session-local ledger without storing prompt/output data.
- Unknown provider usage and unpriced calls fail closed once the corresponding limit is enabled; the CLI never treats missing accounting as zero.
- Route and budget commands are metadata-only and redacted by construction; they do not echo prompt text, response text, credentials, or paths.
